"""Prévision des réapprovisionnements : variables (comptages exacts, aucune
fuite, parité archive ↔ MongoDB), instantanés pendant les ruptures et leurs
étiquettes, méthode naïve, stockage séparé du modèle de rupture, publication
pour les stations favorites.

Comme pour la rupture, les jeux sont synthétiques : on teste la mécanique ; la
qualité est mesurée sur l'archive réelle à chaque entraînement.
"""
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
import pytest

from src.fuel.import_stations import import_stations
from src.fuel.restock_forecast import forecasts
from src.fuel.restock_forecast import train as restock_train
from src.fuel.restock_forecast.dataset import MAX_SHORTAGE_AGE_SECONDS, build_dataset, sample_snapshots
from src.fuel.restock_forecast.features import FEATURE_COLUMNS, RESTOCK_FEATURES, compute_features
from src.fuel.restock_forecast.model import RESTOCK, baseline
from src.fuel.shortage_forecast import episodes
from src.fuel.shortage_forecast.archive import Archive
from src.fuel.shortage_forecast.dataset import Dataset, history_from_archive
from src.fuel.shortage_forecast.features import FEATURE_COLUMNS as SHORTAGE_FEATURES
from src.fuel.shortage_forecast.features import History
from src.fuel.shortage_forecast.model import load_model, save_model, train_and_validate
from src.fuel.shortage_forecast.predict import history_from_mongo

T = pd.Timestamp("2026-10-26 12:00")
H = pd.Timedelta(hours=1)
D = pd.Timedelta(days=1)
NOW = datetime(2026, 10, 26, 12, 0)


def frame(rows, columns):
    return pd.DataFrame(rows, columns=columns)


def shortages(*rows):
    df = frame(rows, ["station", "fuel", "start", "end"])
    df["start"] = pd.to_datetime(df["start"])
    df["end"] = pd.to_datetime(df["end"])
    return df


def sold(*rows, first=pd.Timestamp("2025-01-01"), last=T + 30 * D):
    df = frame(rows, ["station", "fuel", "dept", "pop"])
    df["first_at"], df["last_at"] = first, last
    return df


SOLD = sold(("A", "gazole", "69", "R"), ("A", "e10", "69", "R"),
            ("B", "gazole", "69", "A"), ("C", "gazole", "13", "R"))

SHORTAGES = shortages(
    ("A", "gazole", T - 20 * D, T - 20 * D + 10 * H),   # 10 h
    ("A", "gazole", T - 5 * D, T - 5 * D + 20 * H),     # 20 h
    ("A", "gazole", T - 3 * H, None),                   # en cours, la question posée
    ("A", "e10", T - 30 * H, T - 2 * H),                # l'E10 vient de revenir
    ("B", "gazole", T - 2 * D, T - 10 * H),             # revenu il y a 10 h
    ("C", "gazole", T - 2 * D, T - 5 * H),              # autre département
)


def history(shortage_frame=SHORTAGES, sold_frame=SOLD, as_of=T + 30 * D):
    prices = frame([("A", "gazole", T - 10 * D)], ["station", "fuel", "at"])
    return History(shortage_frame.copy(), sold_frame.copy(), prices, as_of=as_of)


def features_at(h, station="A", fuel="gazole", t=T):
    return compute_features(h, frame([(station, fuel, t)], ["station", "fuel", "t"])).iloc[0]


# --- variables -------------------------------------------------------------------


def test_les_variables_completent_celles_du_modele_de_rupture():
    assert FEATURE_COLUMNS[:len(SHORTAGE_FEATURES) - 2] == SHORTAGE_FEATURES[:-2]
    assert set(RESTOCK_FEATURES) <= set(FEATURE_COLUMNS)
    assert FEATURE_COLUMNS[-2:] == ["fuel", "pop"]


def test_age_de_la_rupture_et_duree_habituelle_du_couple():
    f = features_at(history())

    assert f["shortage_age_hours"] == pytest.approx(3)
    # Deux ruptures closes du couple : 10 h et 20 h → 15 h en moyenne.
    assert f["sf_closed_180d"] == 2
    assert f["sf_mean_duration_hours_180d"] == pytest.approx(15)


def test_fins_de_rupture_recentes_autour():
    f = features_at(history())

    # À la station : l'E10 est revenu il y a 2 h (le gazole lui-même ne compte pas).
    assert f["station_other_ends_24h"] == 1
    # Gazole du 69 : A et B vendus, B revenu il y a 10 h → 1/2.
    assert f["dept_ends_24h_share"] == pytest.approx(1 / 2)
    # Gazole en France : A, B, C ; B et C revenus dans les 24 h → 2/3.
    assert f["nat_ends_24h_share"] == pytest.approx(2 / 3)


def test_un_couple_sans_rupture_close_n_a_pas_de_duree_habituelle():
    f = features_at(history(), station="C")

    assert f["sf_closed_180d"] == 1
    assert np.isnan(features_at(history(shortages(("A", "gazole", T - 3 * H, None)))
                                )["sf_mean_duration_hours_180d"])


def test_aucune_fuite_la_fin_de_la_rupture_en_cours_ne_change_rien():
    """La même rupture, vue à T, qu'on sache ou non qu'elle finira à T + 5 h,
    et quoi qu'il se passe après T ailleurs."""
    ongoing = history()
    future = SHORTAGES.copy()
    future.loc[2, "end"] = T + 5 * H
    future = pd.concat([future, shortages(("B", "gazole", T + H, T + 9 * H),
                                          ("A", "e10", T + 2 * H, T + 4 * H))], ignore_index=True)

    pd.testing.assert_series_equal(features_at(ongoing), features_at(history(future)))


# --- instantanés -----------------------------------------------------------------


def test_les_instantanes_tombent_pendant_les_ruptures_et_sont_bien_etiquetes():
    h = history(as_of=T + 10 * D)

    snaps = sample_snapshots(h, T - 30 * D, T + 10 * D, seed=3)

    sh = h.shortages
    for row in snaps.itertuples():
        mine = sh[(sh["station"] == row.station) & (sh["fuel"] == row.fuel)
                  & (sh["start"] <= row.t) & (sh["end"].isna() | (sh["end"] > row.t))]
        assert len(mine) == 1, row
        end = mine["end"].iloc[0]
        assert row.y == int(pd.notna(end) and end - row.t <= D)


def test_une_rupture_jamais_close_donne_des_negatifs_sur_7_jours_au_plus():
    h = history(shortages(("A", "gazole", T - 20 * D, None)), as_of=T)

    snaps = sample_snapshots(h, T - 30 * D, T, seed=0)

    assert len(snaps) in (7, 8)  # 7 jours, à cheval sur 8 journées
    assert (snaps["y"] == 0).all()
    assert snaps["t"].max() < T - 20 * D + pd.Timedelta(seconds=MAX_SHORTAGE_AGE_SECONDS)


def test_aucun_instantane_dans_les_24_dernieres_heures_de_l_archive():
    h = history(shortages(("A", "gazole", T - 3 * D, None)), as_of=T)

    snaps = sample_snapshots(h, T - 5 * D, T, seed=0)

    assert snaps["t"].max() <= T - D


def test_le_jeu_est_complet_et_non_pondere():
    rows = [("A", "gazole", T - k * D, T - k * D + (6 + k % 30) * H) for k in range(2, 60)]
    ds = build_dataset(history(shortages(*rows), as_of=T), T - 70 * D, T)

    assert len(ds.y) > 40
    assert 0 < ds.y.sum() < len(ds.y)  # des ruptures de plus et de moins de 24 h
    assert set(ds.weight) == {1.0}
    assert list(ds.X.columns) == FEATURE_COLUMNS


def test_parite_archive_et_mongo(db):
    """Une rupture en cours, vue par l'entraînement (archive) et par la
    prévision (MongoDB après synchronisation et import) : mêmes variables."""
    t = pd.Timestamp(NOW)
    arch = Archive(
        stations=frame([("1", "69", "R"), ("2", "69", "R")], ["station", "dept", "pop"]),
        shortages=shortages(
            ("1", "gazole", t - 20 * D, t - 19 * D),
            ("1", "e10", t - 30 * H, t - 3 * H),
            ("2", "gazole", t - 30 * H, t - 20 * H),
            ("1", "gazole", t - 5 * H, None),
        ),
        prices=frame([
            ("1", "gazole", t - 100 * D), ("1", "gazole", t - 2 * D),
            ("1", "e10", t - 100 * D), ("1", "e10", t - 3 * H),
            ("2", "gazole", t - 100 * D), ("2", "gazole", t - 2 * D),
        ], ["station", "fuel", "at"]),
        generated_at=NOW,
    )

    def record(sid, cp, **fields):
        return {"id": sid, "latitude": "4575938", "longitude": "485491", "cp": cp, "pop": "R",
                "adresse": "x", "ville": "y", **fields}

    import_stations(db, [
        record("1", "69003", gazole_maj="2026-10-24T12:00:00+00:00", gazole_rupture_type="temporaire",
               gazole_rupture_debut="2026-10-26T07:00:00+00:00",
               e10_prix=1.8, e10_maj="2026-10-26T09:00:00+00:00"),
        record("2", "69001", gazole_prix=1.9, gazole_maj="2026-10-24T12:00:00+00:00"),
    ], now=NOW)
    episodes.sync_from_archive(db, arch, NOW)
    episodes.record_live(db, NOW)

    queries = frame([("1", "gazole", t)], ["station", "fuel", "t"])
    from_archive = compute_features(history_from_archive(arch), queries)
    from_mongo = compute_features(history_from_mongo(db, NOW), queries)

    pd.testing.assert_frame_equal(from_archive, from_mongo)
    assert from_mongo.loc[0, "shortage_age_hours"] == pytest.approx(5)
    assert from_mongo.loc[0, "station_other_ends_24h"] == 1


# --- méthode naïve et modèle -----------------------------------------------------


def test_methode_naive_duree_sans_memoire_sinon_taux_de_base():
    X = pd.DataFrame({"sf_mean_duration_hours_180d": [24.0, 12.0, np.nan, 0.0]})

    p = baseline(X, prior=0.4)

    assert p[0] == pytest.approx(1 - np.exp(-1))
    assert p[1] == pytest.approx(1 - np.exp(-2))
    assert p[2:].tolist() == [0.4, 0.4]


def synthetic(n=6000, seed=0):
    """La chance de retour dépend de l'âge de la rupture et des livraisons
    alentour ; la méthode naïve ne voit que la durée habituelle."""
    rng = np.random.default_rng(seed)
    X = pd.DataFrame({column: rng.random(n) for column in FEATURE_COLUMNS})
    X["sf_mean_duration_hours_180d"] = rng.uniform(5, 60, n)
    X["shortage_age_hours"] = rng.uniform(0, 160, n)
    X["station_other_ends_24h"] = rng.integers(0, 3, n).astype(float)
    X["fuel"] = rng.integers(0, 6, n).astype(float)
    X["pop"] = rng.integers(0, 2, n).astype(float)
    logit = 1.5 - 0.03 * X["shortage_age_hours"] + 1.5 * X["station_other_ends_24h"]
    y = (rng.random(n) < 1 / (1 + np.exp(-logit))).astype(np.int8).to_numpy()
    t = pd.Timestamp(NOW) - pd.to_timedelta(rng.random(n) * 100, unit="D")
    return Dataset(X=X, y=y, weight=np.ones(n),
                   meta=pd.DataFrame({"station": "1", "fuel": "gazole", "t": t}))


@pytest.fixture(scope="module")
def trained():
    result = train_and_validate(synthetic(), RESTOCK)
    assert result.accepted, result.reason
    return result


def test_le_modele_bat_la_methode_naive(trained):
    assert trained.metrics["test"]["brier"] < trained.metrics["baseline"]["brier"]
    assert trained.model.feature_columns == FEATURE_COLUMNS


def test_refuse_un_echantillon_sans_negatifs():
    ds = synthetic(n=3000)
    ds.y[:] = 1

    result = train_and_validate(ds, RESTOCK)

    assert not result.accepted
    assert "sans réapprovisionnements" in result.reason


def test_stocke_a_part_du_modele_de_rupture(db, trained):
    save_model(db, trained, data_until=NOW, trained_at=NOW, spec=RESTOCK)

    assert db["fuel_restock_models"].find_one({"_id": "current"})["featureColumns"] == FEATURE_COLUMNS
    assert db["fuel_shortage_models"].count_documents({}) == 0
    assert load_model(db, NOW) is None  # le modèle de rupture n'existe pas
    assert load_model(db, NOW, RESTOCK) is not None


def test_un_entrainement_sur_trop_peu_de_ruptures_est_refuse_et_trace(db, capsys):
    h = history(as_of=T)

    assert restock_train.run(db, h, NOW, NOW) is False
    assert "moins de" in db["fuel_restock_models"].find_one({"_id": "last_rejected"})["reason"]
    assert db["fuel_restock_models"].find_one({"_id": "current"}) is None


# --- prévisions publiées ---------------------------------------------------------


def favorites(db):
    """Alice suit la station 1 : gazole en rupture depuis 3 h, E10 disponible,
    SP98 en rupture depuis 10 jours. Bob suit la 2 (GPLc en rupture). La 3 n'est
    favorite de personne."""
    db["favorite_stations"].insert_many([
        {"userId": "alice@example.com", "stationId": "1", "addedAt": NOW},
        {"userId": "bob@example.com", "stationId": "2", "addedAt": NOW},
    ])

    def station(sid, **fuels):
        return {"id": sid, "latitude": "4575938", "longitude": "485491", "cp": "69003",
                "adresse": "x", "ville": "Lyon", **fuels}

    import_stations(db, [
        station("1", gazole_rupture_type="temporaire", gazole_rupture_debut="2026-10-26T09:00:00+00:00",
                e10_prix=1.8, e10_maj="2026-10-26T07:00:00+00:00",
                sp98_rupture_type="temporaire", sp98_rupture_debut="2026-10-16T09:00:00+00:00"),
        station("2", gplc_rupture_type="temporaire", gplc_rupture_debut="2026-10-25T09:00:00+00:00"),
        station("3", gazole_rupture_type="temporaire", gazole_rupture_debut="2026-10-26T09:00:00+00:00"),
    ], now=NOW)
    episodes.record_live(db, NOW)


def test_couples_prevus_ruptures_recentes_des_favorites(db):
    favorites(db)

    assert forecasts.shortage_pairs(db, NOW) == [("1", "gazole"), ("2", "gplc")]


def test_publie_la_chance_de_reapprovisionnement(db, trained):
    favorites(db)
    save_model(db, trained, data_until=NOW, trained_at=NOW, spec=RESTOCK)

    chances = forecasts.publish_restock_forecasts(db, NOW)

    assert sorted(chances) == [("1", "gazole"), ("2", "gplc")]
    doc = db["fuel_restock_forecasts"].find_one({"_id": "1:gazole"})
    assert doc["stationId"] == "1" and doc["fuel"] == "gazole"
    assert doc["computedAt"] == NOW and doc["horizonHours"] == 24
    assert doc["probability"] == round(chances[("1", "gazole")], 3)
    assert "risk" not in doc
    # La prévision de rupture n'est pas touchée.
    assert db["fuel_shortage_forecasts"].count_documents({}) == 0


def test_une_nouvelle_publication_remplace_l_ancienne(db, trained):
    favorites(db)
    save_model(db, trained, data_until=NOW, trained_at=NOW, spec=RESTOCK)
    forecasts.publish_restock_forecasts(db, NOW)
    db["favorite_stations"].delete_one({"userId": "bob@example.com"})

    later = NOW + timedelta(minutes=30)
    forecasts.publish_restock_forecasts(db, later)

    assert [d["_id"] for d in db["fuel_restock_forecasts"].find()] == ["1:gazole"]


def test_sans_modele_les_previsions_sont_retirees(db):
    favorites(db)
    db["fuel_restock_forecasts"].insert_one({"_id": "1:gazole", "probability": 0.9, "computedAt": NOW})

    assert forecasts.publish_restock_forecasts(db, NOW) is None
    assert db["fuel_restock_forecasts"].count_documents({}) == 0


def test_une_prevision_qui_echoue_ne_leve_pas_et_ne_touche_a_rien(db, trained, monkeypatch, capsys):
    favorites(db)
    save_model(db, trained, data_until=NOW, trained_at=NOW, spec=RESTOCK)
    db["fuel_restock_forecasts"].insert_one({"_id": "1:gazole", "probability": 0.9, "computedAt": NOW})

    def broken(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr("src.fuel.restock_forecast.features.compute_context_features", broken)

    assert forecasts.publish_restock_forecasts(db, NOW) is None
    assert "prévision impossible" in capsys.readouterr().out
    assert db["fuel_restock_forecasts"].count_documents({}) == 1

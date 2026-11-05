"""Variables explicatives : comptages exacts, absence de fuite de données, et
**parité** entre l'historique lu dans l'archive (entraînement) et celui lu
dans MongoDB (prévision en direct) — la propriété dont dépend tout le reste.
"""
from datetime import datetime

import numpy as np
import pandas as pd
import pytest

from src.fuel.import_stations import import_stations
from src.fuel.shortage_forecast import episodes
from src.fuel.shortage_forecast.archive import Archive
from src.fuel.shortage_forecast.dataset import build_dataset, history_from_archive, sample_snapshots
from src.fuel.shortage_forecast.features import (
    FEATURE_COLUMNS,
    History,
    compute_features,
    is_active,
    label,
)
from src.fuel.shortage_forecast.predict import history_from_mongo

T = pd.Timestamp("2026-10-26 12:00")
H = pd.Timedelta(hours=1)
D = pd.Timedelta(days=1)


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
    ("A", "gazole", T - 20 * D, T - 19 * D),
    ("A", "gazole", T - 5 * D, T - 4.5 * D),
    ("A", "e10", T - 2 * H, None),            # en cours
    ("B", "gazole", T - 3 * H, T - 2 * H),    # close depuis 2 h
)

PRICES = frame([("A", "gazole", T - 10 * H)], ["station", "fuel", "at"])


def history(shortage_frame=SHORTAGES, prices=PRICES, sold_frame=SOLD):
    return History(shortage_frame.copy(), sold_frame.copy(), prices.copy(), as_of=T + 30 * D)


def features_at(h, station="A", fuel="gazole", t=T):
    return compute_features(h, frame([(station, fuel, t)], ["station", "fuel", "t"])).iloc[0]


def test_compte_l_historique_du_couple():
    f = features_at(history())

    assert (f["sf_starts_7d"], f["sf_starts_30d"], f["sf_starts_180d"]) == (1, 2, 2)
    assert f["sf_hours_since_end"] == pytest.approx(4.5 * 24)
    assert f["sf_hours_since_price"] == pytest.approx(10)


def test_voit_les_autres_carburants_de_la_station():
    f = features_at(history())

    assert f["station_other_active"] == 1
    assert f["station_other_starts_24h"] == 1
    assert f["station_fuels_sold"] == 2


def test_parts_du_departement_et_de_la_france():
    f = features_at(history())

    # Gazole dans le 69 : A et B. B a commencé une rupture il y a 3 h, close.
    assert f["dept_active_share"] == 0
    assert f["dept_starts_24h_share"] == pytest.approx(1 / 2)
    assert f["dept_starts_7d_share"] == pytest.approx(2 / 2)
    assert f["nat_starts_24h_share"] == pytest.approx(1 / 3)
    assert f["nat_active_share"] == 0


def test_calendrier_en_heure_de_paris_et_categories():
    f = features_at(history())

    # 26/10/2026 12:00 UTC = 13:00 à Paris (heure d'hiver), un lundi.
    assert f["hour_local"] == 13
    assert f["weekday_local"] == 0
    assert f["fuel"] == 0
    assert f["pop"] == 0


def test_aucune_fuite_l_avenir_ne_change_rien():
    future = shortages(
        ("A", "gazole", T + H, T + 5 * H),
        ("A", "sp98", T + 2 * H, None),
        ("B", "gazole", T + 3 * H, None),
        ("C", "gazole", T + 1 * D, None),
    )
    prices = pd.concat([PRICES, frame([("A", "gazole", T + H)], ["station", "fuel", "at"])])
    leaked = history(pd.concat([SHORTAGES, future], ignore_index=True), prices)

    pd.testing.assert_series_equal(features_at(leaked), features_at(history()))


def test_une_station_sans_historique_n_a_pas_de_dates():
    f = features_at(history(), station="C")

    assert f["sf_starts_180d"] == 0
    assert np.isnan(f["sf_hours_since_end"])
    assert np.isnan(f["sf_hours_since_price"])


def test_une_station_inconnue_ne_leve_pas():
    f = features_at(history(), station="Z")

    assert np.isnan(f["pop"])
    assert np.isnan(f["dept_active_share"])


def test_ignore_les_ruptures_closes_en_moins_d_une_heure():
    blip = shortages(("C", "gazole", T - 2 * H, T - 2 * H + pd.Timedelta(minutes=10)))

    assert features_at(history(blip), station="C")["sf_starts_7d"] == 0


def test_une_rupture_jamais_close_cesse_de_compter_apres_7_jours():
    stale = shortages(("A", "e10", T - 8 * D, None))

    assert features_at(history(stale))["station_other_active"] == 0


def test_actif_et_etiquette():
    h = history(pd.concat([SHORTAGES, shortages(("A", "gazole", T + 23 * H, None))], ignore_index=True))
    q = frame([("A", "e10", T), ("A", "gazole", T), ("A", "gazole", T - 2 * D), ("B", "gazole", T)],
              ["station", "fuel", "t"])

    assert is_active(h, q).tolist() == [True, False, False, False]
    # Rupture dans ]t, t + 24 h] : oui pour A/gazole à T, non deux jours avant.
    assert label(h, q).tolist() == [0, 1, 0, 0]


def test_un_instantane_par_jour_et_par_couple_vendu_disponible():
    first, last = pd.Timestamp("2026-10-23"), pd.Timestamp("2026-10-27 23:59:59")
    h = History(SHORTAGES.copy(), sold(("A", "gazole", "69", "R"), ("A", "e10", "69", "R"),
                                       first=first, last=last), PRICES.copy(), as_of=T + 10 * D)

    snaps = sample_snapshots(h, first, last, negative_rate=1.0, seed=1)

    # 2 couples × 5 jours, moins l'instantané d'E10 tombé pendant sa rupture
    # (ouverte à T − 2 h, comptée en cours 7 jours) quand il y en a un.
    assert set(snaps["fuel"]) == {"gazole", "e10"}
    assert len(snaps[snaps["fuel"] == "gazole"]) == 5
    assert (snaps["t"].dt.normalize().value_counts() <= 2).all()
    assert not is_active(h, snaps).any()


def test_le_sous_echantillonnage_garde_les_positifs_et_pondere_les_negatifs():
    h = History(shortages(*[("A", "gazole", T - k * D + 6 * H, T - k * D + 9 * H) for k in range(1, 30)]),
                sold(("A", "gazole", "69", "R"), first=T - 40 * D), PRICES.copy(), as_of=T + D)

    ds = build_dataset(h, T - 40 * D, T, negative_rate=0.5, seed=0)

    assert ds.y.sum() >= 20
    assert set(ds.weight[ds.y == 1]) == {1.0}
    assert set(ds.weight[ds.y == 0]) <= {2.0}
    assert list(ds.X.columns) == FEATURE_COLUMNS


def test_aucun_instantane_dans_les_24_dernieres_heures_de_l_archive():
    h = History(SHORTAGES.copy(), sold(("C", "gazole", "13", "R"), first=T - 5 * D, last=T),
                PRICES.copy(), as_of=T)

    snaps = sample_snapshots(h, T - 5 * D, T, negative_rate=1.0)

    assert snaps["t"].max() <= T - D


# --- parité archive / MongoDB ------------------------------------------------


NOW = datetime(2026, 10, 26, 12, 0)


def record(station_id, cp, **fields):
    base = {"id": station_id, "latitude": "4575938", "longitude": "485491", "cp": cp, "pop": "R",
            "adresse": "x", "ville": "y", "gazole_prix": 1.9, "gazole_maj": "2026-10-26T02:00:00+00:00"}
    base.update(fields)
    return base


def test_les_variables_sont_les_memes_depuis_l_archive_et_depuis_mongo(db):
    """Le même état du monde, vu par l'entraînement (archive) et par la
    prévision (MongoDB après synchronisation et import), donne les mêmes
    variables — sinon le modèle verrait en production autre chose que ce sur
    quoi il a appris."""
    t = pd.Timestamp(NOW)
    arch = Archive(
        stations=frame([("1", "69", "R"), ("2", "69", "R"), ("3", "13", "R")], ["station", "dept", "pop"]),
        shortages=shortages(
            ("1", "gazole", t - 20 * D, t - 19 * D),
            ("1", "gazole", t - 3 * D, t - 2.5 * D),
            ("1", "e10", t - 5 * H, None),
            ("2", "gazole", t - 30 * H, t - 20 * H),
        ),
        prices=frame([
            ("1", "gazole", t - 100 * D), ("1", "gazole", t - 10 * H),
            ("1", "e10", t - 100 * D), ("1", "e10", t - 6 * H),
            ("2", "gazole", t - 100 * D), ("2", "gazole", t - 2 * D),
            ("3", "gazole", t - 100 * D), ("3", "gazole", t - 5 * D),
        ], ["station", "fuel", "at"]),
        generated_at=NOW,
    )
    # Le flux instantané au même moment : la station 1 est en rupture d'E10.
    import_stations(db, [
        record("1", "69003", gazole_maj="2026-10-26T02:00:00+00:00", e10_prix=None,
               e10_maj="2026-10-26T06:00:00+00:00", e10_rupture_type="temporaire",
               e10_rupture_debut="2026-10-26T07:00:00+00:00"),
        record("2", "69001", gazole_maj="2026-10-24T12:00:00+00:00"),
        record("3", "13001", gazole_maj="2026-10-21T12:00:00+00:00"),
    ], now=NOW)
    episodes.sync_from_archive(db, arch, NOW)
    episodes.record_live(db, NOW)

    queries = frame([(s, "gazole", t) for s in ("1", "2", "3")], ["station", "fuel", "t"])
    from_archive = compute_features(history_from_archive(arch), queries)
    from_mongo = compute_features(history_from_mongo(db, NOW), queries)

    pd.testing.assert_frame_equal(from_archive, from_mongo)
    assert from_archive.loc[0, "station_other_active"] == 1
    # Gazole dans le 69 : stations 1 (il y a 3 jours) et 2 (il y a 30 h).
    assert from_archive.loc[1, "dept_starts_7d_share"] == pytest.approx(2 / 2)
    assert from_archive.loc[1, "dept_starts_24h_share"] == 0

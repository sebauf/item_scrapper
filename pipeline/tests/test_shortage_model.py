"""Modèle : découpage temporel, garde-fou contre la méthode naïve, stockage
dans MongoDB, et refus des modèles périmés ou incompatibles.

Les jeux sont synthétiques et petits : on teste la mécanique, pas la qualité
du modèle — celle-ci est mesurée sur l'archive réelle à chaque entraînement
(métriques stockées avec le modèle).
"""
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
import pytest

from src.fuel import restock_alerts
from src.fuel.import_stations import import_stations
from src.fuel.shortage_forecast import model as module
from src.fuel.shortage_forecast.dataset import Dataset
from src.fuel.shortage_forecast.features import FEATURE_COLUMNS
from src.fuel.shortage_forecast.model import (
    ShortageModel,
    load_model,
    record_rejection,
    save_model,
    split_masks,
    train_and_validate,
)

NOW = datetime(2026, 10, 26, 12, 0)


def synthetic(n=8000, seed=0, baseline_is_perfect=False):
    """Instantanés sur 100 jours. Le risque dépend de l'historique du couple
    **et** du jour de la semaine : la méthode naïve ne voit que le premier."""
    rng = np.random.default_rng(seed)
    X = pd.DataFrame({column: rng.random(n) for column in FEATURE_COLUMNS})
    X["sf_starts_30d"] = rng.integers(0, 6, n).astype(float)
    X["weekday_local"] = rng.integers(0, 7, n).astype(float)
    X["fuel"] = rng.integers(0, 6, n).astype(float)
    X["pop"] = rng.integers(0, 2, n).astype(float)
    if baseline_is_perfect:
        y = (X["sf_starts_30d"] >= 4).astype(np.int8).to_numpy()
    else:
        logit = -4 + 0.8 * X["sf_starts_30d"] + 2.5 * (X["weekday_local"] == 0)
        y = (rng.random(n) < 1 / (1 + np.exp(-logit))).astype(np.int8).to_numpy()
    t = pd.Timestamp(NOW) - pd.to_timedelta(rng.random(n) * 100, unit="D")
    meta = pd.DataFrame({"station": "1", "fuel": "gazole", "t": t})
    return Dataset(X=X, y=y, weight=np.ones(n), meta=meta)


@pytest.fixture(scope="module")
def trained():
    result = train_and_validate(synthetic())
    assert result.accepted, result.reason
    return result


def test_decoupage_temporel_sans_chevauchement():
    t = pd.Series(pd.date_range("2026-01-01", periods=100 * 24, freq="h"))
    end = t.max() + pd.Timedelta(seconds=1)

    train, calibration, test = split_masks(t, end, 28)

    assert t[train].max() < t[calibration].min() - pd.Timedelta(hours=23)
    assert t[calibration].max() < t[test].min() - pd.Timedelta(hours=23)
    assert t[test].min() >= end - pd.Timedelta(days=28)
    assert (t[calibration].max() - t[calibration].min()) < pd.Timedelta(days=21)


def test_le_modele_bat_la_methode_naive_et_est_accepte(trained):
    test, naive = trained.metrics["test"], trained.metrics["baseline"]

    assert test["averagePrecision"] > naive["averagePrecision"]
    assert test["brier"] < naive["brier"]
    assert 0 < test["meanPredicted"] < 1


def test_refuse_un_modele_qui_ne_fait_pas_mieux_que_la_frequence():
    result = train_and_validate(synthetic(baseline_is_perfect=True))

    assert not result.accepted
    assert result.model is None
    assert "fréquence" in result.reason


def test_refuse_un_echantillon_trop_petit():
    result = train_and_validate(synthetic(n=300))

    assert not result.accepted
    assert "moins de" in result.reason


def test_probabilites_entre_0_et_1(trained):
    p = trained.model.predict(synthetic(n=500, seed=3).X)

    assert ((p >= 0) & (p <= 1)).all()


def test_sauvegarde_puis_relit_le_modele(db, trained):
    save_model(db, trained, data_until=NOW, trained_at=NOW)

    loaded = load_model(db, NOW + timedelta(days=1))

    assert isinstance(loaded, ShortageModel)
    X = synthetic(n=50, seed=4).X
    np.testing.assert_allclose(loaded.predict(X), trained.model.predict(X))
    doc = db["fuel_shortage_models"].find_one({"_id": "current"})
    assert doc["featureColumns"] == FEATURE_COLUMNS
    assert doc["metrics"]["test"]["auc"] > 0.5


def test_un_refus_ne_touche_pas_au_modele_en_service(db, trained):
    save_model(db, trained, data_until=NOW, trained_at=NOW)
    rejected = train_and_validate(synthetic(baseline_is_perfect=True))

    record_rejection(db, rejected, NOW + timedelta(days=1))

    assert load_model(db, NOW + timedelta(days=1)) is not None
    assert "fréquence" in db["fuel_shortage_models"].find_one({"_id": "last_rejected"})["reason"]


@pytest.mark.parametrize("change", [
    {"trainedAt": NOW - timedelta(days=8)},
    {"featureColumns": FEATURE_COLUMNS[:-1]},
    {"sklearnVersion": "0.0.1"},
])
def test_ignore_un_modele_perime_ou_incompatible(db, trained, change, capsys):
    save_model(db, trained, data_until=NOW, trained_at=NOW)
    db["fuel_shortage_models"].update_one({"_id": "current"}, {"$set": change})

    assert load_model(db, NOW) is None
    assert "ignoré" in capsys.readouterr().out


def test_sans_modele_rien(db):
    assert load_model(db, NOW) is None


# --- prévision des stations surveillées -----------------------------------------


def watched(db):
    db["user_profiles"].insert_one({"_id": "alice@example.com", "phone": "+33612345678",
                                    "alertFuels": ["gazole"]})
    db["favorite_stations"].insert_one({"userId": "alice@example.com", "stationId": "1", "addedAt": NOW})
    import_stations(db, [{"id": "1", "latitude": "4575938", "longitude": "485491", "cp": "69003",
                          "adresse": "x", "ville": "Lyon", "gazole_prix": 1.9,
                          "gazole_maj": "2026-10-26T07:00:00+00:00"}], now=NOW)


def test_prevoit_le_risque_des_couples_surveilles(db, trained):
    watched(db)
    save_model(db, trained, data_until=NOW, trained_at=NOW)

    risks = restock_alerts.predict_watched_risks(db, NOW)

    assert list(risks) == [("1", "gazole")]
    assert 0 <= risks[("1", "gazole")] <= 1


def test_sans_modele_pas_de_prevision(db):
    watched(db)

    assert restock_alerts.predict_watched_risks(db, NOW) is None


def test_une_prevision_qui_echoue_ne_leve_pas(db, trained, monkeypatch, capsys):
    watched(db)
    save_model(db, trained, data_until=NOW, trained_at=NOW)

    def broken(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr("src.fuel.shortage_forecast.predict.compute_features", broken)

    assert restock_alerts.predict_watched_risks(db, NOW) is None
    assert "prévision impossible" in capsys.readouterr().out


def test_les_constantes_de_decoupage_sont_coherentes():
    assert module.CALIBRATION_DAYS + module.TEST_DAYS + 2 * module.GAP_DAYS < 100

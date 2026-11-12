"""Tâche d'import carburant : l'ordre des étapes et ce qui ne doit pas l'arrêter.

L'ordre compte : la prévision lit les ruptures que `record_live` vient
d'enregistrer, et l'alerte lit le risque que la prévision vient de publier.
"""
from datetime import datetime

import mongomock
import pytest

from src import database
from src.fuel import import_job
from src.fuel.alerts import FuelAlertConfig
from src.fuel.shortage_forecast import episodes

NOW = datetime(2026, 10, 26, 12, 0)
CONFIG = FuelAlertConfig(webhook_url="http://hermes/webhooks/fuel", webhook_secret="s3cr3t")
RISKS = {("1", "gazole"): 0.7}


@pytest.fixture
def steps(monkeypatch):
    """Remplace les étapes 3 à 5 par des témoins ; renvoie les appels."""
    calls = []
    monkeypatch.setattr(episodes, "record_live", lambda db, now: calls.append("episodes") or (0, 0))
    monkeypatch.setattr(import_job, "publish_forecasts", lambda db, now: calls.append("rupture") or RISKS)
    monkeypatch.setattr(import_job, "publish_restock_forecasts", lambda db, now: calls.append("retour"))
    monkeypatch.setattr(
        import_job, "alert_fuel_events",
        lambda db, config, now, risks: calls.append(("alerte", risks)),
    )
    return calls


def test_enchaine_episodes_previsions_puis_alerte(db, steps):
    import_job.publish_after_import(db, NOW, CONFIG)

    assert steps == ["episodes", "rupture", "retour", ("alerte", RISKS)]


def test_sans_webhook_aucune_alerte(db, steps):
    import_job.publish_after_import(db, NOW, None)

    assert steps == ["episodes", "rupture", "retour"]


def test_un_echec_des_episodes_n_arrete_ni_les_previsions_ni_l_alerte(db, steps, monkeypatch, capsys):
    def broken(db, now):
        raise RuntimeError("base indisponible")

    monkeypatch.setattr(episodes, "record_live", broken)
    import_job.publish_after_import(db, NOW, CONFIG)

    assert steps == ["rupture", "retour", ("alerte", RISKS)]
    assert "fuel_shortages: mise à jour impossible" in capsys.readouterr().out


def test_main_importe_les_prix_meme_sans_export_osm(monkeypatch, capsys):
    client = mongomock.MongoClient()
    monkeypatch.setenv("MONGODB_URI", "mongodb://test")
    monkeypatch.delenv("FUEL_RESTOCK_WEBHOOK_URL", raising=False)
    monkeypatch.setattr(database, "MongoClient", lambda uri: client)
    monkeypatch.setattr(import_job, "fetch_records", lambda: [
        {"id": 1, "latitude": "4575938", "longitude": "485491", "cp": "69003",
         "adresse": "12 avenue Félix Faure", "ville": "Lyon",
         "gazole_prix": 1.689, "gazole_maj": "2026-10-26T07:42:00+00:00"},
    ])

    def osm_unavailable():
        raise OSError("data.gouv.fr injoignable")

    monkeypatch.setattr(import_job, "fetch_osm_stations", osm_unavailable)
    import_job.main()

    out = capsys.readouterr().out
    assert client["scrapper"]["fuel_stations"].count_documents({}) == 1
    assert "keeping known brands" in out
    assert "fuel_stations: 1 stations imported (1 records received)" in out

"""Alerte de réapprovisionnement : détection avant/après import et webhook signé.

Les états avant/après sont produits par le vrai `import_stations` sur un
mongomock, comme en production. Aucun test n'appelle le réseau — `urlopen` est
remplacé.
"""
import hashlib
import hmac
import json
from datetime import datetime, timedelta
from urllib.error import URLError

import pytest

from src.fuel import restock_alerts as module
from src.fuel.import_stations import import_stations
from src.fuel.restock_alerts import (
    RestockWatch,
    alert_restocks,
    detect_restocks,
    format_summary,
    haversine_km,
    sign,
    watched_stations,
)

NOW = datetime(2026, 10, 26, 12, 0)
LATER = NOW + timedelta(hours=5)

# Place Bellecour, Lyon.
HOME = {"FUEL_WATCH_LAT": "45.7578", "FUEL_WATCH_LNG": "4.8320"}


def watch(**overrides):
    values = dict(lat=45.7578, lng=4.8320, radius_km=5.0, fuels=("gazole",),
                  webhook_url="http://hermes:8644/webhooks/fuel-restock", webhook_secret="s3cr3t")
    values.update(overrides)
    return RestockWatch(**values)


def record(station_id, latitude="4575938", longitude="485491", **fields):
    """Station à ~1,8 km de Bellecour par défaut (Lyon 3e)."""
    base = {
        "id": station_id,
        "latitude": latitude,
        "longitude": longitude,
        "cp": "69003",
        "adresse": "12 avenue Félix Faure",
        "ville": "Lyon",
        "gazole_prix": 1.689,
        "gazole_maj": "2026-10-26T07:42:00+00:00",
    }
    base.update(fields)
    return base


def in_shortage(station_id, **fields):
    return record(station_id, gazole_prix=None, gazole_rupture_type="temporaire",
                  gazole_rupture_debut="2026-10-24T12:30:00+00:00", **fields)


def run(db, before_records, after_records, w=None):
    """Deux imports successifs ; renvoie les réapprovisionnements détectés."""
    w = w or watch()
    import_stations(db, before_records, now=NOW)
    before = watched_stations(db["fuel_stations"], w)
    import_stations(db, after_records, now=LATER)
    return detect_restocks(before, watched_stations(db["fuel_stations"], w), w.fuels)


# --- detect_restocks -------------------------------------------------------


def test_detecte_un_gazole_de_retour_apres_une_rupture(db):
    restocks = run(db, [in_shortage(1)], [record(1, gazole_prix=1.719)])

    assert len(restocks) == 1
    r = restocks[0]
    assert (r["stationId"], r["fuel"], r["price"]) == ("1", "gazole", 1.719)
    assert r["shortageSince"] == datetime(2026, 10, 24, 12, 30)
    assert r["city"] == "Lyon"
    assert 1 < r["distanceKm"] < 3


def test_une_rupture_avec_prix_affiche_compte_aussi(db):
    # Le flux garde souvent le dernier prix pendant une rupture temporaire.
    shortage = record(1, gazole_rupture_type="temporaire")

    assert len(run(db, [shortage], [record(1)])) == 1


def test_rien_si_le_carburant_etait_deja_disponible(db):
    assert run(db, [record(1)], [record(1, gazole_prix=1.5)]) == []


def test_rien_si_la_rupture_continue(db):
    assert run(db, [in_shortage(1)], [in_shortage(1)]) == []


def test_une_nouvelle_station_n_est_pas_un_reapprovisionnement(db):
    assert run(db, [record(1)], [record(1), record(2)]) == []


def test_un_carburant_qui_n_etait_pas_vendu_n_est_pas_un_reapprovisionnement(db):
    assert run(db, [record(1, gazole_prix=None, e10_prix=1.8)], [record(1)]) == []


def test_ignore_les_carburants_non_surveilles(db):
    before = [record(1, e10_prix=None, e10_rupture_type="temporaire")]
    after = [record(1, e10_prix=1.799)]

    assert run(db, before, after) == []
    restocks = run(db, before, after, watch(fuels=("gazole", "e10")))
    assert [r["fuel"] for r in restocks] == ["e10"]


def test_ignore_les_stations_hors_zone(db):
    # Marseille : ~280 km.
    far = {"latitude": "4329650", "longitude": "536980"}

    assert run(db, [in_shortage(1, **far)], [record(1, **far)]) == []


def test_trie_du_plus_proche_au_plus_loin(db):
    near = {"latitude": "4575800", "longitude": "483200"}  # Bellecour même
    restocks = run(db, [in_shortage(1), in_shortage(2, **near)], [record(1), record(2, **near)])

    assert [r["stationId"] for r in restocks] == ["2", "1"]


def test_haversine_lyon_paris():
    assert haversine_km(45.7578, 4.8320, 48.8566, 2.3522) == pytest.approx(392, abs=2)


# --- RestockWatch.from_env -------------------------------------------------


def test_desactive_sans_position():
    assert RestockWatch.from_env({}) is None
    assert RestockWatch.from_env({"FUEL_WATCH_LAT": "45.7"}) is None


def test_valeurs_par_defaut():
    w = RestockWatch.from_env(HOME)

    assert (w.lat, w.lng, w.radius_km, w.fuels) == (45.7578, 4.832, 5.0, ("gazole",))
    assert w.webhook_url is None


def test_lit_toute_la_configuration():
    w = RestockWatch.from_env({**HOME, "FUEL_WATCH_RADIUS_KM": "12.5",
                               "FUEL_WATCH_FUELS": " Gazole, e10 ",
                               "FUEL_RESTOCK_WEBHOOK_URL": "http://h/webhooks/x",
                               "FUEL_RESTOCK_WEBHOOK_SECRET": "abc"})

    assert (w.radius_km, w.fuels) == (12.5, ("gazole", "e10"))
    assert (w.webhook_url, w.webhook_secret) == ("http://h/webhooks/x", "abc")


@pytest.mark.parametrize("extra", [
    {"FUEL_WATCH_LAT": "abc"},
    {"FUEL_WATCH_LAT": "91"},
    {"FUEL_WATCH_RADIUS_KM": "0"},
    {"FUEL_WATCH_FUELS": "diesel"},
    {"FUEL_RESTOCK_WEBHOOK_URL": "http://h/webhooks/x"},  # sans secret
])
def test_une_configuration_invalide_desactive_sans_lever(extra):
    assert RestockWatch.from_env({**HOME, **extra}) is None


# --- message et webhook ----------------------------------------------------


def restock(**fields):
    base = {"stationId": "1", "brand": "Avia", "name": None, "address": "12 avenue Félix Faure",
            "postcode": "69003", "city": "Lyon", "distanceKm": 1.84, "fuel": "gazole",
            "price": 1.719, "updatedAt": LATER, "shortageSince": datetime(2026, 10, 24, 12, 30)}
    base.update(fields)
    return base


def test_le_resume_est_lisible_tel_quel():
    summary = format_summary([restock()], watch())

    assert summary.splitlines()[0] == "⛽ Gazole de retour dans 1 station(s) à moins de 5 km :"
    assert "Avia, 12 avenue Félix Faure, 69003 Lyon — 1,719 € (1,84 km)" in summary
    assert "en rupture depuis le 24/10 à" in summary


def test_le_resume_tolere_une_station_anonyme_sans_date_de_rupture():
    summary = format_summary([restock(brand=None, shortageSince=None)], watch())

    assert "— Station, " in summary
    assert "rupture" not in summary


def test_signature_generic_v2():
    expected = hmac.new(b"k", b"1700000000.{}", hashlib.sha256).hexdigest()

    assert sign("k", 1700000000, b"{}") == expected


class FakeResponse:
    status = 202

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@pytest.fixture
def sent(monkeypatch):
    calls = []

    def fake_urlopen(request, timeout):
        calls.append(request)
        return FakeResponse()

    monkeypatch.setattr(module, "urlopen", fake_urlopen)
    monkeypatch.setattr(module.time, "time", lambda: 1700000000.4)
    return calls


def test_envoie_un_webhook_signe_et_verifiable(db, sent):
    import_stations(db, [in_shortage(1)], now=NOW)
    before = watched_stations(db["fuel_stations"], watch())
    import_stations(db, [record(1)], now=LATER)

    alert_restocks(watch(), before, watched_stations(db["fuel_stations"], watch()), LATER)

    assert len(sent) == 1
    request = sent[0]
    headers = {k.lower(): v for k, v in request.header_items()}
    assert request.full_url == "http://hermes:8644/webhooks/fuel-restock"
    assert headers["x-webhook-timestamp"] == "1700000000"
    assert headers["x-webhook-signature-v2"] == sign("s3cr3t", 1700000000, request.data)
    assert headers["x-request-id"] == "fuel-restock-20261026T170000"

    payload = json.loads(request.data)
    assert payload["event_type"] == "fuel_restock"
    assert payload["count"] == 1
    assert payload["importedAt"] == "2026-10-26T17:00:00+00:00"
    assert payload["restocks"][0]["shortageSince"] == "2026-10-24T12:30:00+00:00"
    assert payload["summary"].startswith("⛽ Gazole de retour")


def test_n_envoie_rien_sans_reapprovisionnement(sent):
    assert alert_restocks(watch(), {}, {}, LATER) == []
    assert sent == []


def test_sans_url_detecte_mais_n_envoie_rien(db, sent):
    restocks = alert_restocks(watch(webhook_url=None), {"1": {"fuels": [
        {"code": "gazole", "available": False, "shortageSince": None}]}},
        {"1": {"distanceKm": 1.0, "fuels": [
            {"code": "gazole", "available": True, "price": 1.7, "updatedAt": LATER}]}}, LATER)

    assert len(restocks) == 1
    assert sent == []


def test_un_echec_d_envoi_ne_fait_pas_echouer_l_import(monkeypatch, capsys):
    def failing_urlopen(request, timeout):
        raise URLError("connection refused")

    monkeypatch.setattr(module, "urlopen", failing_urlopen)
    before = {"1": {"fuels": [{"code": "gazole", "available": False, "shortageSince": None}]}}
    after = {"1": {"distanceKm": 1.0, "fuels": [
        {"code": "gazole", "available": True, "price": 1.7, "updatedAt": LATER}]}}

    assert len(alert_restocks(watch(), before, after, LATER)) == 1
    assert "alerte perdue" in capsys.readouterr().out

"""Alerte de réapprovisionnement par utilisateur : détection sur le dernier
état connu, un webhook signé par destinataire.

Les imports successifs passent par le vrai `import_stations` sur un mongomock,
suivis de `alert_restocks`, comme en production. Les profils et favorites sont
écrits dans la forme qu'utilise le backend (`user_profiles`,
`favorite_stations`). Aucun test n'appelle le réseau — `urlopen` est remplacé
pour tous les tests du fichier.
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
    RestockConfig,
    Subscriber,
    alert_restocks,
    format_summary,
    mask_phone,
    request_id,
    sign,
    subscribers,
)

NOW = datetime(2026, 10, 26, 12, 0)
LATER = NOW + timedelta(hours=5)
STEP = timedelta(minutes=30)

ALICE = "alice@example.com"
BOB = "bob@example.com"
ALICE_PHONE = "+33612345678"
BOB_PHONE = "+33698765432"

CONFIG = RestockConfig(webhook_url="http://hermes:8644/webhooks/fuel-restock", webhook_secret="s3cr3t")


def record(station_id, **fields):
    base = {
        "id": station_id,
        "latitude": "4575938",
        "longitude": "485491",
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


def neither(station_id, **fields):
    """Rupture close sans prix redéclaré : ni prix, ni rupture (cas du 28/10)."""
    return record(station_id, gazole_prix=None, **fields)


def profile(db, user=ALICE, phone=ALICE_PHONE, fuels=("gazole",)):
    db["user_profiles"].replace_one(
        {"_id": user}, {"phone": phone, "alertFuels": list(fuels), "updatedAt": NOW}, upsert=True
    )


def favorite(db, *station_ids, user=ALICE):
    for station_id in station_ids:
        db["favorite_stations"].replace_one(
            {"userId": user, "stationId": str(station_id)},
            {"userId": user, "stationId": str(station_id), "addedAt": NOW},
            upsert=True,
        )


class FakeResponse:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@pytest.fixture(autouse=True)
def sent(monkeypatch):
    """Requêtes « envoyées » ; aucun test ne touche le réseau."""
    calls = []

    def fake_urlopen(request, timeout):
        calls.append(request)
        return FakeResponse()

    monkeypatch.setattr(module, "urlopen", fake_urlopen)
    monkeypatch.setattr(module.time, "time", lambda: 1700000000.4)
    return calls


def run(db, *imports):
    """Imports successifs, chacun suivi de l'alerte ; renvoie les
    réapprovisionnements détectés au dernier, par utilisateur."""
    detected = {}
    for i, records in enumerate(imports):
        now = NOW + i * STEP
        import_stations(db, records, now=now)
        detected = alert_restocks(db, CONFIG, now)
    return detected


@pytest.fixture
def alice(db):
    """Alice : numéro, gazole, station 1 en favorite."""
    profile(db)
    favorite(db, 1)
    return db


def payloads(sent):
    return [json.loads(request.data) for request in sent]


# --- détection -------------------------------------------------------


def test_detecte_un_gazole_de_retour_apres_une_rupture(alice):
    detected = run(alice, [in_shortage(1)], [record(1, gazole_prix=1.719)])

    assert list(detected) == [ALICE]
    r = detected[ALICE][0]
    assert (r["stationId"], r["fuel"], r["price"]) == ("1", "gazole", 1.719)
    assert r["shortageSince"] == datetime(2026, 10, 24, 12, 30)
    assert r["city"] == "Lyon"


def test_une_rupture_avec_prix_affiche_compte_aussi(alice):
    # Le flux garde souvent le dernier prix pendant une rupture temporaire.
    shortage = record(1, gazole_rupture_type="temporaire")

    assert len(run(alice, [shortage], [record(1)])[ALICE]) == 1


def test_rien_si_le_carburant_etait_deja_disponible(alice, sent):
    assert run(alice, [record(1)], [record(1, gazole_prix=1.5)]) == {}
    assert sent == []


def test_rien_si_la_rupture_continue(alice):
    assert run(alice, [in_shortage(1)], [in_shortage(1)]) == {}


def test_un_carburant_qui_n_etait_pas_vendu_n_est_pas_un_reapprovisionnement(alice):
    assert run(alice, [record(1, gazole_prix=None, e10_prix=1.8)], [record(1)]) == {}


def test_ignore_les_carburants_que_l_utilisateur_ne_surveille_pas(alice):
    before = [record(1, e10_prix=None, e10_rupture_type="temporaire")]
    after = [record(1, e10_prix=1.799)]

    assert run(alice, before, after) == {}
    profile(alice, fuels=("gazole", "e10"))
    assert [r["fuel"] for r in run(alice, before, after)[ALICE]] == ["e10"]


def test_ignore_les_stations_qui_ne_sont_pas_favorites(alice):
    assert run(alice, [in_shortage(2)], [record(2)]) == {}


def test_regression_station_sans_prix_ni_rupture_puis_retour_du_gazole(alice):
    # 60330004 le 28/10 : tout en rupture, puis plus rien de déclaré — la
    # station sort de `fuel_stations` —, puis le gazole revient au prix.
    all_short = in_shortage(1, e10_prix=None, e10_rupture_type="temporaire")
    nothing = neither(1)
    # Une seconde station garde l'import au-dessus du garde-fou de troncature.
    other = record(2)

    detected = run(alice, [all_short, other], [nothing, other], [nothing, other],
                   [record(1, gazole_prix=2.25), other])

    assert [(r["stationId"], r["fuel"], r["price"]) for r in detected[ALICE]] == [("1", "gazole", 2.25)]
    assert detected[ALICE][0]["shortageSince"] == datetime(2026, 10, 24, 12, 30)


def test_regression_gazole_seul_sans_prix_ni_rupture(alice):
    # Les autres carburants restent vendus : la station reste, le gazole manque.
    detected = run(alice, [in_shortage(1, e10_prix=1.8)], [neither(1, e10_prix=1.8)],
                   [record(1, e10_prix=1.8)])

    assert [(r["stationId"], r["fuel"]) for r in detected[ALICE]] == [("1", "gazole")]


def test_premier_passage_enregistre_l_etat_sans_alerter(alice, sent):
    assert run(alice, [in_shortage(1)]) == {}
    assert sent == []
    state = alice["fuel_watch_state"].find_one({"_id": f"{ALICE}:1:gazole"})
    assert (state["userId"], state["stationId"], state["available"]) == (ALICE, "1", False)


def test_pas_de_doublon_d_un_import_a_l_autre(alice):
    assert run(alice, [in_shortage(1)], [record(1)], [record(1)], [record(1, gazole_prix=1.5)]) == {}


def test_garde_l_etat_d_une_favorite_absente_du_flux(alice):
    run(alice, [in_shortage(1), record(2)], [record(2)])

    assert alice["fuel_watch_state"].find_one({"_id": f"{ALICE}:1:gazole"})["available"] is False


# --- qui est surveillé -------------------------------------------------


@pytest.mark.parametrize("change", [
    lambda db: profile(db, phone=None),
    lambda db: profile(db, fuels=()),
    lambda db: db["favorite_stations"].delete_many({}),
    lambda db: db["user_profiles"].delete_many({}),
])
def test_il_faut_numero_carburant_et_station(alice, sent, change):
    change(alice)

    assert run(alice, [in_shortage(1)], [record(1)]) == {}
    assert sent == []
    assert alice["fuel_watch_state"].count_documents({}) == 0


@pytest.mark.parametrize("phone", ["0612345678", "+33 6 12 34 56 78", "", 33612345678])
def test_ignore_un_numero_qui_n_est_pas_au_format_e164(db, phone):
    profile(db, phone=phone)
    favorite(db, 1)

    assert subscribers(db) == []


def test_ignore_un_carburant_inconnu_dans_le_profil(db):
    profile(db, fuels=("kerosene", "e10", "gazole"))
    favorite(db, 1)

    assert subscribers(db)[0].fuels == ("gazole", "e10")


def test_une_favorite_sans_proprietaire_n_alerte_personne(alice):
    # Favorite antérieure aux comptes, pas encore rattachée par le backend.
    alice["favorite_stations"].insert_one({"_id": "2", "addedAt": NOW})

    assert subscribers(alice)[0].station_ids == frozenset({"1"})


def test_chacun_recoit_ses_stations_et_ses_carburants_a_son_numero(db, sent):
    profile(db, ALICE, ALICE_PHONE, ("gazole",))
    profile(db, BOB, BOB_PHONE, ("gazole", "e10"))
    favorite(db, 1, user=ALICE)
    favorite(db, 1, 2, user=BOB)
    before = [in_shortage(1, e10_prix=None, e10_rupture_type="temporaire"), in_shortage(2)]
    after = [record(1, e10_prix=1.8), record(2)]

    detected = run(db, before, after)

    assert [(r["stationId"], r["fuel"]) for r in detected[ALICE]] == [("1", "gazole")]
    assert [(r["stationId"], r["fuel"]) for r in detected[BOB]] == [
        ("1", "gazole"), ("1", "e10"), ("2", "gazole"),
    ]
    by_phone = {p["to"]: p for p in payloads(sent)}
    assert set(by_phone) == {ALICE_PHONE, BOB_PHONE}
    assert by_phone[ALICE_PHONE]["count"] == 1
    assert by_phone[BOB_PHONE]["count"] == 3
    assert by_phone[BOB_PHONE]["fuels"] == ["gazole", "e10"]


def test_une_station_ajoutee_en_rupture_alerte_a_son_retour(alice):
    # Bob met en favori une station déjà suivie par Alice : son premier
    # passage enregistre la rupture pour lui, sans réalerter Alice.
    run(alice, [in_shortage(1)])
    profile(alice, BOB, BOB_PHONE)
    favorite(alice, 1, user=BOB)

    detected = run(alice, [in_shortage(1)], [record(1)])

    assert set(detected) == {ALICE, BOB}


# --- oubli des états ---------------------------------------------------


def test_oublie_l_etat_d_une_favorite_retiree(alice):
    favorite(alice, 2)
    run(alice, [in_shortage(1), in_shortage(2)])
    alice["favorite_stations"].delete_one({"stationId": "2"})

    run(alice, [in_shortage(1), in_shortage(2)])

    assert {d["stationId"] for d in alice["fuel_watch_state"].find()} == {"1"}


def test_oublie_l_etat_d_un_carburant_decoche(alice):
    profile(alice, fuels=("gazole", "e10"))
    run(alice, [in_shortage(1, e10_prix=1.8)])
    profile(alice, fuels=("e10",))

    run(alice, [in_shortage(1, e10_prix=1.8)])

    assert {d["fuel"] for d in alice["fuel_watch_state"].find()} == {"e10"}


def test_supprime_les_etats_de_l_ancienne_alerte_globale(alice):
    alice["fuel_watch_state"].insert_one(
        {"_id": "1:gazole", "stationId": "1", "fuel": "gazole", "available": False}
    )

    run(alice, [record(1)])

    assert [d["_id"] for d in alice["fuel_watch_state"].find()] == [f"{ALICE}:1:gazole"]


# --- RestockConfig.from_env ------------------------------------------------


def test_desactive_sans_webhook():
    assert RestockConfig.from_env({}) is None


def test_lit_le_webhook_et_son_secret():
    config = RestockConfig.from_env({"FUEL_RESTOCK_WEBHOOK_URL": "http://h/webhooks/x",
                                     "FUEL_RESTOCK_WEBHOOK_SECRET": "abc"})

    assert config == RestockConfig("http://h/webhooks/x", "abc")


def test_un_webhook_sans_secret_desactive_sans_lever(capsys):
    assert RestockConfig.from_env({"FUEL_RESTOCK_WEBHOOK_URL": "http://h/webhooks/x"}) is None
    assert "SECRET manquant" in capsys.readouterr().out


# --- message et webhook ----------------------------------------------------


def restock(**fields):
    base = {"stationId": "1", "brand": "Avia", "name": None, "address": "12 avenue Félix Faure",
            "postcode": "69003", "city": "Lyon", "fuel": "gazole",
            "price": 1.719, "updatedAt": LATER, "shortageSince": datetime(2026, 10, 24, 12, 30)}
    base.update(fields)
    return base


def test_le_resume_est_lisible_tel_quel():
    summary = format_summary([restock()])

    assert summary.splitlines()[0] == "⛽ Gazole de retour dans 1 station(s) favorite(s) :"
    assert "• Gazole — Avia, 12 avenue Félix Faure, 69003 Lyon — 1,719 €" in summary
    assert "en rupture depuis le 24/10 à" in summary


def test_le_resume_annonce_les_carburants_revenus_dans_l_ordre_canonique():
    summary = format_summary([restock(fuel="sp98"), restock(fuel="gazole", stationId="2")])

    assert summary.splitlines()[0] == "⛽ Gazole, SP98 de retour dans 2 station(s) favorite(s) :"


def test_le_resume_tolere_une_station_anonyme_sans_date_de_rupture():
    summary = format_summary([restock(brand=None, shortageSince=None)])

    assert "— Station, " in summary
    assert "rupture" not in summary


def test_signature_generic_v2():
    expected = hmac.new(b"k", b"1700000000.{}", hashlib.sha256).hexdigest()

    assert sign("k", 1700000000, b"{}") == expected


def test_envoie_un_webhook_signe_au_numero_de_l_utilisateur(alice, sent):
    import_stations(alice, [in_shortage(1)], now=NOW)
    alert_restocks(alice, CONFIG, NOW)
    import_stations(alice, [record(1)], now=LATER)

    alert_restocks(alice, CONFIG, LATER)

    assert len(sent) == 1
    request = sent[0]
    headers = {k.lower(): v for k, v in request.header_items()}
    assert request.full_url == "http://hermes:8644/webhooks/fuel-restock"
    assert headers["x-webhook-timestamp"] == "1700000000"
    assert headers["x-webhook-signature-v2"] == sign("s3cr3t", 1700000000, request.data)
    user_hash = hashlib.sha256(ALICE.encode()).hexdigest()[:12]
    assert headers["x-request-id"] == f"fuel-restock-20261026T170000-{user_hash}"

    payload = json.loads(request.data)
    assert payload["event_type"] == "fuel_restock"
    assert payload["to"] == ALICE_PHONE
    assert payload["count"] == 1
    assert payload["fuels"] == ["gazole"]
    assert payload["importedAt"] == "2026-10-26T17:00:00+00:00"
    assert payload["restocks"][0]["shortageSince"] == "2026-10-24T12:30:00+00:00"
    assert payload["summary"].startswith("⛽ Gazole de retour")
    # L'agent n'a besoin que du numéro : l'adresse e-mail ne sort pas.
    assert ALICE not in request.data.decode()


def test_l_identifiant_de_requete_distingue_les_destinataires():
    a = Subscriber(ALICE, ALICE_PHONE, ("gazole",), frozenset({"1"}))
    b = Subscriber(BOB, BOB_PHONE, ("gazole",), frozenset({"1"}))

    assert request_id(a, NOW) != request_id(b, NOW)
    assert request_id(a, NOW) == request_id(a, NOW)


def test_un_echec_d_envoi_garde_la_rupture_et_reessaie_au_prochain_import(alice, monkeypatch, capsys):
    def failing_urlopen(request, timeout):
        raise URLError("connection refused")

    import_stations(alice, [in_shortage(1)], now=NOW)
    alert_restocks(alice, CONFIG, NOW)
    import_stations(alice, [record(1)], now=LATER)
    monkeypatch.setattr(module, "urlopen", failing_urlopen)

    assert len(alert_restocks(alice, CONFIG, LATER)[ALICE]) == 1
    out = capsys.readouterr().out
    assert "nouvel essai" in out
    assert ALICE_PHONE not in out  # numéro masqué dans les journaux
    assert alice["fuel_watch_state"].find_one({"_id": f"{ALICE}:1:gazole"})["available"] is False

    calls = []
    monkeypatch.setattr(module, "urlopen", lambda request, timeout: calls.append(request) or FakeResponse())
    import_stations(alice, [record(1)], now=LATER + STEP)

    assert len(alert_restocks(alice, CONFIG, LATER + STEP)[ALICE]) == 1
    assert len(calls) == 1
    assert alice["fuel_watch_state"].find_one({"_id": f"{ALICE}:1:gazole"})["available"] is True


def test_un_echec_pour_l_un_ne_reenvoie_pas_a_l_autre(db, monkeypatch):
    profile(db, ALICE, ALICE_PHONE)
    profile(db, BOB, BOB_PHONE)
    favorite(db, 1, user=ALICE)
    favorite(db, 1, user=BOB)
    import_stations(db, [in_shortage(1)], now=NOW)
    alert_restocks(db, CONFIG, NOW)

    def bob_fails(request, timeout):
        if json.loads(request.data)["to"] == BOB_PHONE:
            raise URLError("refusé")
        return FakeResponse()

    monkeypatch.setattr(module, "urlopen", bob_fails)
    import_stations(db, [record(1)], now=LATER)
    alert_restocks(db, CONFIG, LATER)

    import_stations(db, [record(1)], now=LATER + STEP)
    retried = alert_restocks(db, CONFIG, LATER + STEP)

    assert list(retried) == [BOB]


def test_masque_le_numero():
    assert mask_phone("+33612345678") == "+33•••••5678"

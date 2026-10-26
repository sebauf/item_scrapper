"""Import des stations-service depuis l'API « Prix des carburants ».

Les enregistrements reproduisent la forme réelle de l'API Opendatasoft :
coordonnées multipliées par 100 000 (souvent en chaîne), colonnes aplaties par
carburant, dates ISO 8601 avec fuseau. Aucun test n'appelle le réseau —
`fetch_records` n'est jamais invoqué, l'import reçoit les enregistrements.
"""
import json
from datetime import datetime, timedelta

import pytest

from src.fuel import import_stations as module
from src.fuel.import_stations import (
    TruncatedFeedError,
    import_stations,
    parse_fuel,
    parse_station,
)

NOW = datetime(2026, 10, 26, 12, 0)


def record(station_id=69003001, **fields):
    base = {
        "id": station_id,
        "latitude": "4575938",
        "longitude": "485491",
        "cp": "69003",
        "pop": "R",
        "adresse": " 12 avenue Félix Faure ",
        "ville": "Lyon",
        "gazole_prix": 1.689,
        "gazole_maj": "2026-10-26T07:42:00+00:00",
    }
    base.update(fields)
    return base


def ids(db):
    return sorted(doc["_id"] for doc in db["fuel_stations"].find({}))


# --- parse_station ---------------------------------------------------------


def test_convertit_les_coordonnees_en_geojson_longitude_d_abord():
    station = parse_station(record(), NOW)

    assert station["location"] == {"type": "Point", "coordinates": [4.85491, 45.75938]}


def test_accepte_des_coordonnees_numeriques():
    station = parse_station(record(latitude=4575938.0, longitude=485491), NOW)

    assert station["location"]["coordinates"] == [4.85491, 45.75938]


@pytest.mark.parametrize("lat", [None, "", "0", "abc", "99999999"])
def test_ignore_une_station_sans_coordonnees_exploitables(lat):
    assert parse_station(record(latitude=lat), NOW) is None


def test_ignore_une_station_sans_aucun_carburant():
    assert parse_station(record(gazole_prix=None, gazole_maj=None), NOW) is None


def test_normalise_les_champs_descriptifs():
    station = parse_station(record(cp=1000, pop="X"), NOW)

    assert station["_id"] == "69003001"
    assert station["address"] == "12 avenue Félix Faure"
    assert station["postcode"] == "1000"
    assert station["roadType"] is None
    assert station["importedAt"] == NOW
    assert station["brand"] is None
    assert station["name"] is None


def test_ajoute_l_enseigne_trouvee_par_identifiant():
    brands = {"69003001": {"brand": "TotalEnergies", "name": "Total Access Lyon Félix Faure"}}

    station = parse_station(record(), NOW, brands)

    assert station["brand"] == "TotalEnergies"
    assert station["name"] == "Total Access Lyon Félix Faure"


def test_garde_l_ordre_d_affichage_des_carburants():
    station = parse_station(record(sp98_prix=1.95, e10_prix=1.80), NOW)

    assert [f["code"] for f in station["fuels"]] == ["gazole", "e10", "sp98"]


# --- parse_fuel ------------------------------------------------------------


def test_un_carburant_avec_prix_est_disponible_et_date_en_utc():
    fuel = parse_fuel({"e10_prix": "1.749", "e10_maj": "2026-10-26T08:00:00+01:00"}, "e10")

    assert fuel == {
        "code": "e10",
        "price": 1.749,
        "updatedAt": datetime(2026, 10, 26, 7, 0),
        "available": True,
        "shortageSince": None,
    }


def test_un_carburant_absent_n_est_pas_vendu():
    assert parse_fuel({}, "gplc") is None


def test_une_rupture_temporaire_garde_le_carburant_mais_indisponible():
    fuel = parse_fuel(
        {
            "e85_prix": 0.899,
            "e85_rupture_type": "temporaire",
            "e85_rupture_debut": "2026-10-24T09:00:00+00:00",
        },
        "e85",
    )

    assert fuel["available"] is False
    assert fuel["price"] == 0.899
    assert fuel["shortageSince"] == datetime(2026, 10, 24, 9, 0)


def test_une_rupture_temporaire_sans_prix_reste_listee():
    fuel = parse_fuel({"e85_rupture_type": "temporaire"}, "e85")

    assert fuel["available"] is False
    assert fuel["price"] is None


def test_une_rupture_definitive_retire_le_carburant():
    assert parse_fuel({"sp95_prix": 1.9, "sp95_rupture_type": "definitive"}, "sp95") is None


def test_un_prix_nul_n_est_pas_un_carburant_gratuit():
    fuel = parse_fuel({"gazole_prix": 0, "gazole_rupture_type": "temporaire"}, "gazole")

    assert fuel["price"] is None
    assert fuel["available"] is False


def test_une_date_illisible_vaut_none():
    fuel = parse_fuel({"gazole_prix": 1.7, "gazole_maj": "hier"}, "gazole")

    assert fuel["updatedAt"] is None
    assert fuel["available"] is True


# --- import_stations -------------------------------------------------------


def test_importe_et_remplace_les_stations(db):
    import_stations(db, [record(1, gazole_prix=1.70)], now=NOW)
    count = import_stations(db, [record(1, gazole_prix=1.65)], now=NOW + timedelta(hours=5))

    assert count == 1
    doc = db["fuel_stations"].find_one({"_id": "1"})
    assert doc["fuels"][0]["price"] == 1.65
    assert doc["importedAt"] == NOW + timedelta(hours=5)


def test_supprime_les_stations_sorties_du_flux(db):
    import_stations(db, [record(1), record(2), record(3)], now=NOW)

    import_stations(db, [record(1), record(2)], now=NOW + timedelta(hours=5))

    assert ids(db) == ["1", "2"]


def test_ignore_les_enregistrements_inexploitables(db):
    count = import_stations(db, [record(1), record(2, latitude=None)], now=NOW)

    assert count == 1
    assert ids(db) == ["1"]


def test_refuse_un_flux_vide_sans_toucher_a_la_base(db):
    import_stations(db, [record(1)], now=NOW)

    with pytest.raises(TruncatedFeedError):
        import_stations(db, [], now=NOW + timedelta(hours=5))

    assert ids(db) == ["1"]


def test_refuse_un_flux_tronque_sans_toucher_a_la_base(db):
    import_stations(db, [record(i) for i in range(10)], now=NOW)

    with pytest.raises(TruncatedFeedError):
        import_stations(db, [record(i) for i in range(4)], now=NOW + timedelta(hours=5))

    assert len(ids(db)) == 10
    assert db["fuel_stations"].find_one({"_id": "0"})["importedAt"] == NOW


def test_accepte_une_baisse_moderee_du_nombre_de_stations(db):
    import_stations(db, [record(i) for i in range(10)], now=NOW)

    import_stations(db, [record(i) for i in range(5)], now=NOW + timedelta(hours=5))

    assert len(ids(db)) == 5


def test_enregistre_les_enseignes(db):
    import_stations(db, [record(1), record(2)], {"1": {"brand": "Avia", "name": None}}, now=NOW)

    assert db["fuel_stations"].find_one({"_id": "1"})["brand"] == "Avia"
    assert db["fuel_stations"].find_one({"_id": "2"})["brand"] is None


def test_sans_export_osm_garde_les_enseignes_connues(db):
    import_stations(db, [record(1)], {"1": {"brand": "Avia", "name": "Avia Lyon"}}, now=NOW)

    import_stations(db, [record(1, gazole_prix=1.5)], None, now=NOW + timedelta(hours=5))

    doc = db["fuel_stations"].find_one({"_id": "1"})
    assert doc["fuels"][0]["price"] == 1.5
    assert (doc["brand"], doc["name"]) == ("Avia", "Avia Lyon")


def test_un_export_osm_a_jour_remplace_l_enseigne(db):
    # Station rachetée : l'export fait foi dès qu'il est disponible.
    import_stations(db, [record(1)], {"1": {"brand": "Esso", "name": None}}, now=NOW)

    import_stations(db, [record(1)], {"1": {"brand": "Avia", "name": None}}, now=NOW + timedelta(hours=5))

    assert db["fuel_stations"].find_one({"_id": "1"})["brand"] == "Avia"


# --- fetch_records ---------------------------------------------------------


def test_fetch_demande_les_colonnes_utiles_en_utc(monkeypatch):
    seen = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def read(self, *args):
            return json.dumps([record()]).encode()

    def fake_urlopen(request, timeout):
        seen["url"] = request.full_url
        return FakeResponse()

    monkeypatch.setattr(module, "urlopen", fake_urlopen)

    assert module.fetch_records() == [record()]
    assert "/exports/json?" in seen["url"]
    assert "timezone=UTC" in seen["url"]
    assert "gazole_rupture_type" in seen["url"]

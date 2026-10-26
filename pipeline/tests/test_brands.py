"""Correspondance station → enseigne, d'après l'export OpenStreetMap.

Le CSV de test reprend l'en-tête et des valeurs réelles de l'export
data.gouv.fr (colonnes `ref:FR:prix-carburants`, `brand`, `name`, `operator`,
`branch`). Aucun test n'appelle le réseau.
"""
import bz2

import pytest

from src.fuel import brands as module
from src.fuel.brands import MIN_OSM_ENTRIES, normalize_brand, parse_osm_csv

HEADER = "ref:FR:prix-carburants,brand,name,operator,branch\n"


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("Total Access", "TotalEnergies"),
        ("Total", "TotalEnergies"),
        ("E. Leclerc", "E.Leclerc"),
        ("E.Leclerc", "E.Leclerc"),
        ("Super U", "Système U"),
        ("Station U", "Système U"),
        ("Carrefour Market", "Carrefour"),
        ("Intermarché Contact", "Intermarché"),
        ("Elan", "Élan"),
        ("AS24", "AS 24"),
        ("AVIA", "Avia"),
        ("Independent", "Indépendante"),
    ],
)
def test_ramene_les_variantes_a_une_enseigne(raw, expected):
    assert normalize_brand(raw) == expected


def test_garde_une_enseigne_inconnue_telle_quelle_mais_nettoyee():
    assert normalize_brand("  Dyneff   Express ") == "Dyneff Express"


@pytest.mark.parametrize("raw", [None, "", "   "])
def test_une_enseigne_vide_vaut_none(raw):
    assert normalize_brand(raw) is None


def test_lit_enseigne_et_nom_par_identifiant_officiel():
    stations = parse_osm_csv(
        HEADER
        + "65310001,Carrefour,Carrefour,Casino,\n"
        + "57140003,Esso,Esso Aire de Saint Rémy (E25/A31),Esso,\n"
    )

    assert stations == {
        "65310001": {"brand": "Carrefour", "name": "Carrefour"},
        "57140003": {"brand": "Esso", "name": "Esso Aire de Saint Rémy (E25/A31)"},
    }


def test_deduit_l_enseigne_d_un_nom_connu():
    stations = parse_osm_csv(HEADER + "1,,Intermarché,SAS Dupont,\n")

    assert stations["1"] == {"brand": "Intermarché", "name": "Intermarché"}


def test_ne_prend_pas_un_nom_quelconque_pour_une_enseigne():
    stations = parse_osm_csv(HEADER + "1,,Garage du Centre,,\n")

    assert stations["1"] == {"brand": None, "name": "Garage du Centre"}


def test_l_exploitant_n_est_pas_l_enseigne():
    # Une station Carrefour exploitée par Casino reste une station Carrefour,
    # et une station sans enseigne ne prend pas le nom de sa SARL.
    stations = parse_osm_csv(HEADER + "1,,,Casino,\n2,Carrefour,,Casino,\n")

    assert "1" not in stations
    assert stations["2"]["brand"] == "Carrefour"


def test_gere_plusieurs_identifiants_sur_une_ligne():
    stations = parse_osm_csv(HEADER + "1; 2,Avia,,,\n2,Esso,,,\n")

    assert stations == {"1": {"brand": "Avia", "name": None}, "2": {"brand": "Avia", "name": None}}


def test_ignore_les_lignes_sans_identifiant():
    assert parse_osm_csv(HEADER + ",Total,Total,,\n") == {}


class FakeResponse:
    def __init__(self, payload: bytes):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self):
        return self.payload


def big_csv(rows=MIN_OSM_ENTRIES) -> str:
    return HEADER + "".join(f"{i},Total Access,,,\n" for i in range(rows))


@pytest.mark.parametrize("compress", [True, False])
def test_fetch_accepte_bz2_ou_csv_en_clair(monkeypatch, compress):
    payload = big_csv().encode()
    if compress:
        payload = bz2.compress(payload)
    monkeypatch.setattr(module, "urlopen", lambda request, timeout: FakeResponse(payload))

    stations = module.fetch_osm_stations()

    assert len(stations) == MIN_OSM_ENTRIES
    assert stations["0"]["brand"] == "TotalEnergies"


def test_fetch_refuse_un_export_tronque(monkeypatch):
    payload = bz2.compress(big_csv(rows=10).encode())
    monkeypatch.setattr(module, "urlopen", lambda request, timeout: FakeResponse(payload))

    with pytest.raises(ValueError, match="inexploitable"):
        module.fetch_osm_stations()

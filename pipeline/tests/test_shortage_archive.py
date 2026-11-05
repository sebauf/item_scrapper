"""Lecture des archives annuelles : fuseau, filtrage des ruptures, fusion
de deux années. Un XML écrit à la main, dans la forme réelle de l'archive
(ISO-8859-1, dates locales sans fuseau)."""
import io
import zipfile
from datetime import datetime

import pandas as pd

from src.fuel.shortage_forecast.archive import Archive, department, parse_archive, read_zip

XML = """<?xml version="1.0" encoding="ISO-8859-1" standalone="yes"?><pdv_liste>
<pdv id="69003001" latitude="4575938" longitude="485491" cp="69003" pop="R">
  <adresse>12 avenue F\xe9lix Faure</adresse>
  <prix nom="Gazole" id="1" maj="2026-01-02T00:37:00" valeur="1.707"/>
  <prix nom="Gazole" id="1" maj="2026-07-10T09:00:00" valeur="2.107"/>
  <prix nom="SP98" id="6" maj="2026-03-01T10:00:00" valeur="1.9"/>
  <rupture id="1" nom="Gazole" debut="2026-07-10T14:53:35" fin="2026-07-11T12:24:20" type="temporaire"/>
  <rupture id="6" nom="SP98" debut="2026-07-12T08:00:00" fin="" type="temporaire"/>
  <rupture id="4" nom="GPLc" debut="2017-09-16T09:50:23" fin="" type="definitive"/>
  <rupture id="3" nom="E85" debut="2017-09-07T11:05:59" fin=""/>
  <rupture id="5" nom="E10" debut="2026-02-01T00:00:00" fin="2026-06-01T00:00:00" type="temporaire"/>
  <rupture id="1" nom="Gazole" debut="2026-07-20T10:00:00" fin="2026-07-19T10:00:00" type="temporaire"/>
</pdv>
<pdv id="20000001" latitude="0" longitude="0" cp="20000" pop="A">
  <prix nom="Gazole" id="1" maj="2026-01-15T12:00:00" valeur="1.8"/>
</pdv>
</pdv_liste>""".encode("latin-1")


def archive():
    return parse_archive(io.BytesIO(XML))


def test_lit_les_stations_et_leur_departement():
    stations = archive().stations.set_index("station")

    assert stations.loc["69003001", "dept"] == "69"
    assert stations.loc["20000001", ["dept", "pop"]].tolist() == ["20", "A"]


def test_convertit_l_heure_de_paris_en_utc():
    gazole = archive().shortages.query("fuel == 'gazole'").sort_values("start").iloc[0]

    # Juillet : heure d'été, UTC+2.
    assert gazole["start"] == pd.Timestamp("2026-07-10 12:53:35")
    assert gazole["end"] == pd.Timestamp("2026-07-11 10:24:20")
    # Janvier : heure d'hiver, UTC+1 — le prix automatique de 00:37 locale.
    assert archive().prices["at"].min() == pd.Timestamp("2026-01-01 23:37:00")


def test_ecarte_les_retraits_definitifs_et_les_ruptures_de_plusieurs_mois():
    fuels = set(archive().shortages["fuel"])

    # GPLc : definitive ; E85 : sans type mais commencée en 2017 et jamais
    # close ; E10 : quatre mois, ce n'est pas un manque de stock.
    assert fuels == {"gazole", "sp98"}


def test_une_fin_anterieure_au_debut_laisse_la_rupture_ouverte():
    late = archive().shortages.query("fuel == 'gazole'").sort_values("start").iloc[-1]

    assert late["start"] == pd.Timestamp("2026-07-20 08:00:00")
    assert pd.isna(late["end"])


def test_la_date_de_generation_est_le_dernier_evenement_lu():
    assert archive().generated_at == datetime(2026, 7, 20, 8, 0)


def test_la_fusion_garde_la_version_close_d_une_rupture_a_cheval():
    a = archive()
    open_version = a.shortages.copy()
    open_version["end"] = pd.NaT
    previous = Archive(a.stations, open_version, a.prices, a.generated_at)

    merged = Archive.concat([previous, a])

    first = merged.shortages.query("fuel == 'gazole'").sort_values("start").iloc[0]
    assert first["end"] == pd.Timestamp("2026-07-11 10:24:20")
    assert len(merged.shortages) == len(a.shortages)
    assert len(merged.prices) == len(a.prices)


def test_lit_le_xml_dans_le_zip_sans_l_extraire(tmp_path):
    path = tmp_path / "annee.zip"
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("PrixCarburants_annuel_2026.xml", XML)

    assert len(read_zip(path).stations) == 2


def test_departement():
    assert department("69003") == "69"
    assert department(" 2A004") == "2A"
    assert department("") == "??"
    assert department(None) == "??"

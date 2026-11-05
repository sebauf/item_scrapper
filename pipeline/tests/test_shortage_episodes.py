"""`fuel_shortages` : tenue en direct par l'import, réalignée chaque nuit sur
l'archive officielle."""
from datetime import datetime, timedelta

import pandas as pd

from src.fuel.import_stations import import_stations
from src.fuel.shortage_forecast.archive import Archive
from src.fuel.shortage_forecast.episodes import episode_id, record_live, sync_from_archive

NOW = datetime(2026, 10, 26, 12, 0)
STEP = timedelta(minutes=30)
SINCE = datetime(2026, 10, 26, 10, 30)


def record(station_id, **fields):
    base = {"id": station_id, "latitude": "4575938", "longitude": "485491", "cp": "69003",
            "adresse": "x", "ville": "Lyon", "gazole_prix": 1.9, "gazole_maj": "2026-10-26T07:00:00+00:00"}
    base.update(fields)
    return base


def in_shortage(station_id, since="2026-10-26T10:30:00+00:00", **fields):
    return record(station_id, gazole_prix=None, gazole_rupture_type="temporaire",
                  gazole_rupture_debut=since, **fields)


def live(db, records, now):
    import_stations(db, records, now=now)
    return record_live(db, now)


def test_ouvre_un_episode_par_rupture_en_cours_sans_doublon(db):
    assert live(db, [in_shortage(1), record(2)], NOW) == (1, 0)
    live(db, [in_shortage(1), record(2)], NOW + STEP)

    docs = list(db["fuel_shortages"].find())
    assert len(docs) == 1
    assert docs[0]["_id"] == "1:gazole:2026-10-26T10:30:00"
    assert (docs[0]["start"], docs[0]["end"], docs[0]["source"]) == (SINCE, None, "live")


def test_ferme_l_episode_au_retour_du_carburant(db):
    live(db, [in_shortage(1), record(2)], NOW)

    assert live(db, [record(1), record(2)], NOW + STEP) == (0, 1)
    assert db["fuel_shortages"].find_one()["end"] == NOW + STEP


def test_supprime_une_rupture_close_en_moins_d_une_heure(db):
    live(db, [in_shortage(1, since="2026-10-26T11:45:00+00:00"), record(2)], NOW)
    live(db, [record(1), record(2)], NOW + STEP)

    assert db["fuel_shortages"].count_documents({}) == 0


def test_un_carburant_absent_ne_ferme_rien(db):
    live(db, [in_shortage(1, e10_prix=1.8), record(2)], NOW)
    # Ni prix ni rupture pour le gazole : on ne sait pas s'il est revenu.
    live(db, [record(1, gazole_prix=None, e10_prix=1.8), record(2)], NOW + STEP)

    assert db["fuel_shortages"].find_one()["end"] is None


def archive(rows, generated_at=NOW):
    shortages = pd.DataFrame(rows, columns=["station", "fuel", "start", "end"])
    shortages["start"] = pd.to_datetime(shortages["start"])
    shortages["end"] = pd.to_datetime(shortages["end"])
    empty = pd.DataFrame(columns=["station", "dept", "pop"])
    return Archive(empty, shortages, pd.DataFrame(columns=["station", "fuel", "at"]), generated_at)


def insert(db, station, start, end=None, source="live"):
    db["fuel_shortages"].insert_one({"_id": episode_id(station, "gazole", start), "stationId": station,
                                     "fuel": "gazole", "start": start, "end": end, "source": source})


def test_l_archive_remplace_la_version_live_du_meme_episode(db):
    insert(db, "1", SINCE)

    sync_from_archive(db, archive([("1", "gazole", SINCE, NOW - timedelta(minutes=10))]), NOW)

    doc = db["fuel_shortages"].find_one()
    assert (doc["source"], doc["end"]) == ("archive", NOW - timedelta(minutes=10))


def test_garde_la_fin_vue_par_l_import_quand_l_archive_la_croit_en_cours(db):
    insert(db, "1", SINCE, end=NOW + STEP)

    sync_from_archive(db, archive([("1", "gazole", SINCE, None)]), NOW + 2 * STEP)

    assert db["fuel_shortages"].find_one()["end"] == NOW + STEP


def test_supprime_un_episode_live_inconnu_de_l_archive_dans_sa_periode(db):
    # Même rupture vue avec une date décalée : l'archive fait foi.
    insert(db, "1", SINCE + timedelta(seconds=1))

    sync_from_archive(db, archive([("1", "gazole", SINCE, None)]), NOW)

    assert [d["_id"] for d in db["fuel_shortages"].find()] == [episode_id("1", "gazole", SINCE)]


def test_garde_les_episodes_live_posterieurs_a_l_archive(db):
    later = NOW + timedelta(hours=3)
    insert(db, "2", later)

    sync_from_archive(db, archive([("1", "gazole", SINCE, None)], generated_at=NOW), NOW + timedelta(hours=4))

    assert db["fuel_shortages"].count_documents({"stationId": "2"}) == 1


def test_oublie_ce_qui_depasse_la_retention(db):
    old = NOW - timedelta(days=250)
    insert(db, "3", old, end=old + timedelta(hours=5), source="archive")

    sync_from_archive(db, archive([("3", "gazole", old, old + timedelta(hours=5)),
                                   ("1", "gazole", SINCE, None)]), NOW)

    assert [d["stationId"] for d in db["fuel_shortages"].find()] == ["1"]

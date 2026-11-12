"""Collection `fuel_shortages` : l'historique des ruptures, tenu en base.

`fuel_stations` ne garde que l'état du dernier import. Or la prévision a
besoin du passé de chaque couple (station × carburant) : combien de ruptures
en 30 jours, depuis quand la dernière est close, combien de stations du
département viennent d'en déclarer une. Un document par épisode :

    _id       "<stationId>:<carburant>:<début ISO, à la seconde>"
    stationId, fuel
    start     début déclaré par la station (UTC)
    end       fin, ou null tant qu'elle dure
    source    "archive" | "live"

Deux écrivains, qui se relaient :

- **l'import, toutes les 30 minutes** (`record_live`) : ouvre un épisode pour
  chaque rupture en cours, le ferme quand le carburant revient. C'est ce qui
  rend la prévision réactive dans la journée ;
- **l'entraînement, chaque nuit** (`sync_from_archive`) : remplace tout ce que
  l'archive officielle couvre par sa version, qui fait foi (elle voit les
  ruptures de quelques minutes entre deux imports, et la date de fin exacte).
  Un épisode live qu'elle ne connaît pas, dans la période qu'elle couvre, est
  supprimé : c'est un doublon (date décalée) ou un artefact.

Une rupture close en moins d'une heure est supprimée, comme elle est écartée
de l'entraînement (cf. features.MIN_SHORTAGE_SECONDS) : les deux côtés du
modèle doivent voir le même historique.
"""
from datetime import datetime, timedelta

import pandas as pd
from pymongo import DeleteOne, ReplaceOne, UpdateOne
from pymongo.database import Database

from src.fuel.import_stations import fuels_by_pair
from src.fuel.shortage_forecast.archive import Archive
from src.fuel.shortage_forecast.features import MIN_SHORTAGE_SECONDS

COLLECTION = "fuel_shortages"

# La plus longue fenêtre des variables est de 180 jours.
RETENTION_DAYS = 200


def episode_id(station_id: str, fuel: str, start: datetime) -> str:
    return f"{station_id}:{fuel}:{start:%Y-%m-%dT%H:%M:%S}"


def ensure_indexes(db: Database):
    db[COLLECTION].create_index([("start", 1)], name="start")
    db[COLLECTION].create_index([("end", 1)], name="end")


def record_live(db: Database, imported_at: datetime) -> tuple[int, int]:
    """Reporte l'état du dernier import dans `fuel_shortages`.

    Renvoie (épisodes ouverts, épisodes fermés). Un carburant absent (station
    disparue du flux, ni prix ni rupture) ne ferme rien : on ne sait pas.
    """
    collection = db[COLLECTION]
    ensure_indexes(db)  # sans effet s'ils existent déjà
    current = fuels_by_pair(db)

    ops, opened = [], 0
    for (station_id, code), fuel in current.items():
        if fuel["available"] or fuel.get("shortageSince") is None:
            continue
        start = fuel["shortageSince"]
        ops.append(UpdateOne(
            {"_id": episode_id(station_id, code, start)},
            {"$setOnInsert": {"stationId": station_id, "fuel": code, "start": start,
                              "end": None, "source": "live"}},
            upsert=True,
        ))
        opened += 1

    closed = 0
    for episode in collection.find({"end": None}, {"stationId": 1, "fuel": 1, "start": 1}):
        fuel = current.get((episode["stationId"], episode["fuel"]))
        if fuel is None or not fuel["available"]:
            continue
        closed += 1
        if imported_at - episode["start"] < timedelta(seconds=MIN_SHORTAGE_SECONDS):
            ops.append(DeleteOne({"_id": episode["_id"]}))
        else:
            ops.append(UpdateOne({"_id": episode["_id"]}, {"$set": {"end": imported_at}}))

    if ops:
        collection.bulk_write(ops, ordered=True)
    return opened, closed


def sync_from_archive(db: Database, archive: Archive, now: datetime) -> int:
    """Aligne `fuel_shortages` sur l'archive pour la période qu'elle couvre.

    Une rupture que l'archive donne en cours mais que l'import a vue close
    garde la fin vue par l'import : l'archive date de la nuit, l'import de
    moins de 30 minutes.
    """
    collection = db[COLLECTION]
    since = now - timedelta(days=RETENTION_DAYS)
    shortages = archive.shortages[archive.shortages["start"] >= pd.Timestamp(since)]
    duration = shortages["end"] - shortages["start"]
    shortages = shortages[shortages["end"].isna() | (duration >= pd.Timedelta(seconds=MIN_SHORTAGE_SECONDS))]

    known_ends = {
        doc["_id"]: doc["end"]
        for doc in collection.find({"end": {"$ne": None}}, {"end": 1})
    }
    ops, ids = [], set()
    for row in shortages.itertuples(index=False):
        start = row.start.to_pydatetime()
        _id = episode_id(row.station, row.fuel, start)
        ids.add(_id)
        end = None if pd.isna(row.end) else row.end.to_pydatetime()
        if end is None:
            end = known_ends.get(_id)
        ops.append(ReplaceOne(
            {"_id": _id},
            {"stationId": row.station, "fuel": row.fuel, "start": start, "end": end, "source": "archive"},
            upsert=True,
        ))
    for lo in range(0, len(ops), 10_000):
        collection.bulk_write(ops[lo:lo + 10_000], ordered=False)

    covered_until = archive.generated_at
    stale = [
        doc["_id"]
        for doc in collection.find({"start": {"$lte": covered_until}}, {"_id": 1})
        if doc["_id"] not in ids
    ]
    for lo in range(0, len(stale), 10_000):
        collection.delete_many({"_id": {"$in": stale[lo:lo + 10_000]}})
    collection.delete_many({"start": {"$lt": since}})
    return len(ids)

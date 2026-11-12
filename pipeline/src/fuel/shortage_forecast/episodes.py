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
from collections.abc import Iterator
from datetime import datetime, timedelta

import pandas as pd
from pymongo import DeleteOne, ReplaceOne, UpdateOne
from pymongo.database import Database

from src.fuel.import_stations import fuels_by_pair
from src.fuel.shortage_forecast.archive import Archive
from src.fuel.shortage_forecast.features import MIN_SHORTAGE_SECONDS

COLLECTION = "fuel_shortages"

# Couvre la plus longue fenêtre des variables (`features.LONGEST_WINDOW_DAYS`),
# avec de la marge.
RETENTION_DAYS = 200

# Taille des lots d'écriture et de suppression de la resynchronisation : une
# archive annuelle compte des dizaines de milliers d'épisodes.
BATCH_SIZE = 10_000


def episode_id(station_id: str, fuel: str, start: datetime) -> str:
    return f"{station_id}:{fuel}:{start:%Y-%m-%dT%H:%M:%S}"


def ensure_indexes(db: Database) -> None:
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
    known_ends = {
        doc["_id"]: doc["end"]
        for doc in collection.find({"end": {"$ne": None}}, {"end": 1})
    }
    episodes = _archive_episodes(archive, since, known_ends)
    for batch in _batches(list(episodes.items())):
        collection.bulk_write(
            [ReplaceOne({"_id": _id}, doc, upsert=True) for _id, doc in batch], ordered=False
        )

    stale = [
        doc["_id"]
        for doc in collection.find({"start": {"$lte": archive.generated_at}}, {"_id": 1})
        if doc["_id"] not in episodes
    ]
    for batch in _batches(stale):
        collection.delete_many({"_id": {"$in": batch}})
    collection.delete_many({"start": {"$lt": since}})
    return len(episodes)


def _archive_episodes(
    archive: Archive, since: datetime, known_ends: dict[str, datetime]
) -> dict[str, dict]:
    """Épisodes de l'archive depuis `since`, sans les ruptures closes trop
    courtes : `_id` → document."""
    shortages = archive.shortages[archive.shortages["start"] >= pd.Timestamp(since)]
    duration = shortages["end"] - shortages["start"]
    shortages = shortages[shortages["end"].isna() | (duration >= pd.Timedelta(seconds=MIN_SHORTAGE_SECONDS))]

    episodes: dict[str, dict] = {}
    for row in shortages.itertuples(index=False):
        start = row.start.to_pydatetime()
        _id = episode_id(row.station, row.fuel, start)
        end = None if pd.isna(row.end) else row.end.to_pydatetime()
        episodes[_id] = {
            "stationId": row.station,
            "fuel": row.fuel,
            "start": start,
            "end": end if end is not None else known_ends.get(_id),
            "source": "archive",
        }
    return episodes


def _batches(items: list) -> Iterator[list]:
    for lo in range(0, len(items), BATCH_SIZE):
        yield items[lo:lo + BATCH_SIZE]

"""Stations favorites des utilisateurs (`favorite_stations`, écrites par le backend).

Une favorite antérieure aux comptes (sans `userId`) n'appartient à personne :
elle n'est ni prévue ni surveillée. Le backend la rattache à
`AUTH_LEGACY_OWNER_EMAIL` à son démarrage (cf. legacy-ownership.ts).
"""
from collections.abc import Iterator

from pymongo.database import Database


def favorite_stations_by_user(db: Database) -> dict[str, set[str]]:
    """Utilisateur → identifiants de ses stations favorites."""
    by_user: dict[str, set[str]] = {}
    for doc in db["favorite_stations"].find(
        {"userId": {"$exists": True}}, {"userId": 1, "stationId": 1}
    ):
        if doc.get("stationId"):
            by_user.setdefault(doc["userId"], set()).add(doc["stationId"])
    return by_user


def favorite_station_fuels(db: Database) -> Iterator[tuple[str, dict]]:
    """(station, carburant) de chaque station favorite d'au moins un
    utilisateur, telle que le dernier import l'a vue."""
    station_ids = sorted(set().union(*favorite_stations_by_user(db).values()))
    for station in db["fuel_stations"].find({"_id": {"$in": station_ids}}, {"fuels": 1}):
        for fuel in station.get("fuels", []):
            yield station["_id"], fuel

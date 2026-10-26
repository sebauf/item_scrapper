"""Importe les prix des carburants de toutes les stations françaises.

Source : le jeu de données officiel « Prix des carburants en France — Flux
instantané v2 », republié par le ministère de l'Économie sur
data.economie.gouv.fr (Licence Ouverte Etalab). Les stations qui vendent plus
de 500 m³ par an sont tenues de déclarer chaque changement de prix et chaque
rupture de stock (arrêté du 12 décembre 2006) ; le flux est rafraîchi toutes
les 10 à 15 minutes.

On lit l'API Opendatasoft plutôt que le fichier XML : JSON, colonnes déjà
aplaties par carburant (`gazole_prix`, `gazole_maj`, `gazole_rupture_type`…),
et l'endpoint `exports` renvoie le jeu complet en une requête — `records`
plafonne à 10 000 lignes paginées, soit à peu près le nombre de stations, donc
trop juste.

Une station = un document `fuel_stations` (`_id` = identifiant officiel du
point de vente). Le document est **remplacé** à chaque import : il décrit
l'état du flux à cet instant, pas un historique.

Trois notions distinctes, à ne pas confondre :

- **vendu** : le carburant a un prix ou une rupture temporaire en cours. Une
  rupture *définitive* veut dire que la station a cessé de le vendre — il
  disparaît alors de la liste, comme un carburant jamais vendu ;
- **disponible** : vendu, avec un prix, et sans rupture en cours ;
- **fraîcheur** : `updatedAt`, la date de déclaration *par la station*. Ce
  n'est pas la date de l'import (`importedAt`), qui ne dit rien du prix.
"""
import json
from datetime import datetime, timezone
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from pymongo import ReplaceOne
from pymongo.database import Database

DATASET_URL = (
    "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/"
    "prix-des-carburants-en-france-flux-instantane-v2/exports/json"
)

# Préfixe des colonnes de l'API → code exposé par le backend. L'ordre est celui
# de l'affichage : du plus vendu au plus rare.
FUELS = ("gazole", "e10", "sp98", "sp95", "e85", "gplc")

STATION_FIELDS = ("id", "latitude", "longitude", "cp", "pop", "adresse", "ville")
FUEL_SUFFIXES = ("prix", "maj", "rupture_debut", "rupture_type")

# Les coordonnées du flux sont des degrés multipliés par 100 000
# (`4575938` → 45,75938°), héritage du format PTV_GEODECIMAL du fichier XML.
COORDINATE_SCALE = 100_000

# Garde-fou contre un flux tronqué : un import qui ramène moins de la moitié
# des stations déjà connues est refusé plutôt qu'appliqué. Sans lui, une
# réponse partielle de l'API supprimerait d'un coup la moitié de la carte.
MIN_KEPT_RATIO = 0.5

REQUEST_TIMEOUT_SECONDS = 120


def fetch_records(url: str = DATASET_URL) -> list[dict]:
    """Télécharge toutes les stations, colonnes utiles seulement.

    `timezone=UTC` : sans lui, l'API rend les dates dans le fuseau du jeu de
    données ; on les veut sans ambiguïté, MongoDB stockant tout en UTC.
    """
    select = ",".join(
        STATION_FIELDS + tuple(f"{fuel}_{suffix}" for fuel in FUELS for suffix in FUEL_SUFFIXES)
    )
    query = urlencode({"select": select, "timezone": "UTC"})
    request = Request(f"{url}?{query}", headers={"Accept": "application/json"})
    with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        return json.load(response)


def _to_float(value) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _coordinate(value, limit: float) -> float | None:
    raw = _to_float(value)
    if raw is None:
        return None
    degrees = raw / COORDINATE_SCALE
    # 0 est la valeur d'une station jamais géolocalisée, pas l'équateur.
    if degrees == 0 or abs(degrees) > limit:
        return None
    return round(degrees, 6)


def _to_utc(value) -> datetime | None:
    """Date ISO 8601 de l'API → datetime UTC naïf, comme le reste de la base.

    Une date sans fuseau est lue comme UTC : c'est ce que `timezone=UTC`
    demande à l'API, et l'heure de Paris serait au pire décalée d'une ou deux
    heures — jamais d'un jour, ce qui suffit à juger la fraîcheur.
    """
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def parse_fuel(record: dict, fuel: str) -> dict | None:
    """Un carburant d'une station, ou None s'il n'y est pas vendu."""
    price = _to_float(record.get(f"{fuel}_prix"))
    shortage_type = record.get(f"{fuel}_rupture_type") or None

    if shortage_type == "definitive":
        return None
    if price is None and shortage_type is None:
        return None
    # Un prix nul ou négatif est une saisie erronée, pas un carburant gratuit.
    if price is not None and price <= 0:
        price = None

    return {
        "code": fuel,
        "price": price,
        "updatedAt": _to_utc(record.get(f"{fuel}_maj")),
        "available": price is not None and shortage_type is None,
        "shortageSince": _to_utc(record.get(f"{fuel}_rupture_debut")) if shortage_type else None,
    }


def parse_station(record: dict, imported_at: datetime) -> dict | None:
    """Document `fuel_stations`, ou None si la station est inexploitable.

    Inexploitable : sans identifiant, sans coordonnées (impossible à placer sur
    la carte, et `$geoNear` refuserait le document), ou sans aucun carburant.
    """
    station_id = record.get("id")
    lat = _coordinate(record.get("latitude"), 90)
    lng = _coordinate(record.get("longitude"), 180)
    if station_id is None or lat is None or lng is None:
        return None

    fuels = [fuel for fuel in (parse_fuel(record, code) for code in FUELS) if fuel is not None]
    if not fuels:
        return None

    return {
        "_id": str(station_id),
        # GeoJSON : longitude d'abord. L'inverse placerait Lyon dans l'océan
        # Indien sans la moindre erreur.
        "location": {"type": "Point", "coordinates": [lng, lat]},
        "address": (record.get("adresse") or "").strip(),
        "city": (record.get("ville") or "").strip(),
        "postcode": str(record.get("cp") or "").strip(),
        # R = route, A = autoroute (prix généralement plus élevés).
        "roadType": record.get("pop") if record.get("pop") in ("R", "A") else None,
        "fuels": fuels,
        "importedAt": imported_at,
    }


class TruncatedFeedError(RuntimeError):
    """Le flux ramène trop peu de stations pour qu'on lui fasse confiance."""


def import_stations(db: Database, records: list[dict], now: datetime | None = None) -> int:
    """Remplace `fuel_stations` par le contenu du flux. Renvoie le nombre de
    stations importées.

    Les stations absentes du flux sont supprimées : une station fermée ne doit
    pas rester sur la carte avec son dernier prix. Mais uniquement après le
    garde-fou — c'est la seule étape qui supprime, et elle ne doit jamais le
    faire sur la foi d'une réponse incomplète.
    """
    imported_at = now or datetime.now(timezone.utc).replace(tzinfo=None)
    stations = [s for s in (parse_station(r, imported_at) for r in records) if s is not None]

    collection = db["fuel_stations"]
    known = collection.count_documents({})
    if not stations or len(stations) < known * MIN_KEPT_RATIO:
        raise TruncatedFeedError(
            f"{len(stations)} station(s) exploitable(s) sur {len(records)} reçue(s), "
            f"pour {known} déjà connue(s) : import refusé, la base reste intacte."
        )

    collection.bulk_write([ReplaceOne({"_id": s["_id"]}, s, upsert=True) for s in stations])
    collection.delete_many({"importedAt": {"$ne": imported_at}})
    return len(stations)


if __name__ == "__main__":
    from pymongo import MongoClient

    from src.config import DB_NAME, MONGODB_URI

    client = MongoClient(MONGODB_URI)
    records = fetch_records()
    count = import_stations(client[DB_NAME], records)
    print(f"fuel_stations: {count} stations imported ({len(records)} records received)")

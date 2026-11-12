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

**Rupture présumée.** Le flux perd souvent la trace d'une rupture : la station
retire le prix du carburant, et la rupture elle-même n'y figure pas — le
carburant disparaît, simplement. Mesuré le 06/11/2026 : des 2 688 ruptures
temporaires ouvertes du flux quotidien (qui, lui, les liste), 2 053 n'avaient
**ni prix ni rupture** dans le flux instantané, qui ne contenait aucune balise
`<rupture>`. Sans mémoire, le carburant sort de la station, et avec lui toute
prévision (« Mes stations » n'affiche plus le E10 en rupture, ni sa chance de
retour). Un carburant vendu qui disparaît du flux est donc gardé **en
rupture** (cf. `presumed_shortages`), daté par, dans l'ordre : l'épisode ouvert
de `fuel_shortages` (rupture déclarée, connue par l'archive officielle ou un
import antérieur), la rupture déjà connue du document précédent, sinon
l'import où il a disparu. Au-delà de `PRESUMED_SHORTAGE_MAX_DAYS`, on le
lâche : une station qui cesse de vendre un carburant sans le déclarer ne doit
pas l'afficher indéfiniment.

L'enseigne (`brand`) et le nom (`name`) ne viennent pas du flux officiel, qui
les ignore, mais d'OpenStreetMap (cf. brands.py).
"""
import json
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from pymongo import ReplaceOne
from pymongo.collection import Collection
from pymongo.database import Database

from src.clock import naive_utc_now
from src.fuel.brands import fetch_osm_stations
from src.fuel.fuels import FUELS

DATASET_URL = (
    "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/"
    "prix-des-carburants-en-france-flux-instantane-v2/exports/json"
)

STATION_FIELDS = ("id", "latitude", "longitude", "cp", "pop", "adresse", "ville")
# Colonnes de chaque carburant dans l'API, préfixées par son code : `gazole_prix`…
FUEL_SUFFIXES = ("prix", "maj", "rupture_debut", "rupture_type")

# Les coordonnées du flux sont des degrés multipliés par 100 000
# (`4575938` → 45,75938°), héritage du format PTV_GEODECIMAL du fichier XML.
COORDINATE_SCALE = 100_000

# Garde-fou contre un flux tronqué : un import qui ramène moins de la moitié
# des stations déjà connues est refusé plutôt qu'appliqué. Sans lui, une
# réponse partielle de l'API supprimerait d'un coup la moitié de la carte.
MIN_KEPT_RATIO = 0.5

REQUEST_TIMEOUT_SECONDS = 120

# Durée maximale d'une rupture présumée (carburant disparu du flux). Même borne
# que le modèle de réapprovisionnement (`MAX_SHORTAGE_AGE_SECONDS`) : au-delà,
# une rupture ouverte ne se distingue plus d'un carburant abandonné.
PRESUMED_SHORTAGE_MAX_DAYS = 7


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


def parse_station(
    record: dict,
    imported_at: datetime,
    brands: dict[str, dict] | None = None,
    presumed: dict[str, dict] | None = None,
) -> dict | None:
    """Document `fuel_stations`, ou None si la station est inexploitable.

    Inexploitable : sans identifiant, sans coordonnées (impossible à placer sur
    la carte, et `$geoNear` refuserait le document), ou sans aucun carburant.

    `presumed` : carburant → rupture présumée (cf. `presumed_shortages`),
    utilisée seulement si le flux ne dit **rien** de ce carburant. Une rupture
    définitive déclarée l'emporte : la station a dit qu'elle arrêtait.
    """
    station_id = record.get("id")
    lat = _coordinate(record.get("latitude"), 90)
    lng = _coordinate(record.get("longitude"), 180)
    if station_id is None or lat is None or lng is None:
        return None

    presumed = presumed or {}
    fuels = []
    for code in FUELS:
        fuel = parse_fuel(record, code)
        if fuel is None and code in presumed and record.get(f"{code}_rupture_type") != "definitive":
            fuel = presumed[code]
        if fuel is not None:
            fuels.append(fuel)
    if not fuels:
        return None

    osm = (brands or {}).get(str(station_id), {})
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
        "brand": osm.get("brand"),
        "name": osm.get("name"),
        "fuels": fuels,
        "importedAt": imported_at,
    }


def presumed_shortages(db: Database, now: datetime) -> dict[str, dict[str, dict]]:
    """Station → carburant → rupture présumée, pour les carburants que le flux
    aurait omis. Lue **avant** que l'import ne remplace `fuel_stations`.

    Candidats : les carburants du document précédent de chaque station et les
    épisodes ouverts de `fuel_shortages`. `shortageSince`, par ordre de
    confiance :

    1. le début de l'épisode ouvert — déclaré par la station (l'archive de la
       nuit le connaît même quand le flux instantané l'a perdu) ;
    2. la rupture du document précédent, si elle était déjà en cours ;
    3. l'instant de cet import, si le carburant était disponible au précédent :
       il vient de disparaître, à 30 minutes près.

    Une rupture précédente sans date est abandonnée : la dater de cet import
    la rajeunirait à chaque passage, elle ne s'éteindrait jamais.
    """
    oldest = now - timedelta(days=PRESUMED_SHORTAGE_MAX_DAYS)
    declared = _open_shortage_starts(db, oldest)
    previous = fuels_by_pair(db)

    presumed: dict[str, dict[str, dict]] = {}
    for key in declared.keys() | previous.keys():
        station_id, code = key
        before = previous.get(key)
        since = declared.get(key)
        if since is None and before is not None:
            since = now if before.get("available") else before.get("shortageSince")
        if since is None or since < oldest:
            continue
        presumed.setdefault(station_id, {})[code] = _presumed_fuel(code, since, before)
    return presumed


def fuels_by_pair(db: Database) -> dict[tuple[str, str], dict]:
    """Carburants du dernier import, par (station, code)."""
    return {
        (station["_id"], fuel["code"]): fuel
        for station in db["fuel_stations"].find({}, {"fuels": 1})
        for fuel in station.get("fuels", [])
    }


def _open_shortage_starts(db: Database, oldest: datetime) -> dict[tuple[str, str], datetime]:
    """Début déclaré de la rupture ouverte de chaque (station, carburant) ; la
    plus récente s'il y en a plusieurs."""
    starts: dict[tuple[str, str], datetime] = {}
    for episode in db["fuel_shortages"].find(
        {"end": None, "start": {"$gte": oldest}}, {"stationId": 1, "fuel": 1, "start": 1}
    ):
        key = (episode["stationId"], episode["fuel"])
        starts[key] = max(episode["start"], starts.get(key, episode["start"]))
    return starts


def _presumed_fuel(code: str, since: datetime, before: dict | None) -> dict:
    return {
        "code": code,
        "price": None,
        # La dernière déclaration connue pour ce carburant : la fraîcheur
        # reste celle de la station, jamais celle de notre import.
        "updatedAt": (before or {}).get("updatedAt") or since,
        "available": False,
        "shortageSince": since,
    }


class TruncatedFeedError(RuntimeError):
    """Le flux ramène trop peu de stations pour qu'on lui fasse confiance."""


def _known_brands(collection: Collection) -> dict[str, dict]:
    """Enseignes déjà en base, pour un import où l'export OSM a échoué."""
    return {
        doc["_id"]: {"brand": doc.get("brand"), "name": doc.get("name")}
        for doc in collection.find({}, {"brand": 1, "name": 1})
    }


def import_stations(
    db: Database,
    records: list[dict],
    brands: dict[str, dict] | None = None,
    now: datetime | None = None,
) -> int:
    """Remplace `fuel_stations` par le contenu du flux. Renvoie le nombre de
    stations importées.

    Les stations absentes du flux sont supprimées : une station fermée ne doit
    pas rester sur la carte avec son dernier prix. Mais uniquement après le
    garde-fou — c'est la seule étape qui supprime, et elle ne doit jamais le
    faire sur la foi d'une réponse incomplète.

    `brands` à None (export OSM indisponible) : on garde les enseignes déjà
    connues plutôt que de les effacer. Les prix, eux, sont mis à jour — une
    panne de data.gouv.fr ne doit pas bloquer l'essentiel.
    """
    imported_at = now or naive_utc_now()
    collection = db["fuel_stations"]
    if brands is None:
        brands = _known_brands(collection)
    presumed = presumed_shortages(db, imported_at)

    stations = [
        s
        for s in (
            parse_station(r, imported_at, brands, presumed.get(str(r.get("id"))))
            for r in records
        )
        if s is not None
    ]

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
    import os

    from src.database import open_database
    from src.fuel.alerts import FuelAlertConfig, alert_fuel_events
    from src.fuel.restock_forecast.forecasts import publish_restock_forecasts
    from src.fuel.shortage_forecast import episodes
    from src.fuel.shortage_forecast.forecasts import publish_forecasts

    records = fetch_records()
    try:
        brands = fetch_osm_stations()
    except (OSError, ValueError) as error:
        print(f"brands: OSM export unavailable ({error}), keeping known brands")
        brands = None

    restock = FuelAlertConfig.from_env(os.environ)

    imported_at = naive_utc_now()
    with open_database() as db:
        count = import_stations(db, records, brands, now=imported_at)
        branded = db["fuel_stations"].count_documents({"brand": {"$ne": None}})
        print(f"fuel_stations: {count} stations imported ({len(records)} records received)")
        print(f"brands: {branded}/{count} stations matched to a brand")

        # L'historique des ruptures sert à la prévision : tenu à jour même sans
        # alerte configurée, pour qu'un modèle activé plus tard ait son passé.
        try:
            opened, closed = episodes.record_live(db, imported_at)
            print(f"fuel_shortages: {opened} rupture(s) en cours, {closed} close(s) à cet import")
        except Exception as error:  # noqa: BLE001 — les prix sont importés, c'est l'essentiel
            print(f"fuel_shortages: mise à jour impossible ({error!r})")

        # Risque de rupture à 24 h des stations favorites : publié pour la page
        # « Mes stations », même sans alerte configurée, puis relu par l'alerte.
        # Après `record_live` : la prévision lit les ruptures de cet import.
        risks = publish_forecasts(db, imported_at)
        # Et, pour les carburants en rupture de ces stations, la chance qu'ils
        # reviennent dans les 24 h (page « Mes stations » seulement).
        publish_restock_forecasts(db, imported_at)

        if restock:
            alert_fuel_events(db, restock, imported_at,
                              risks if restock.risk_threshold is not None else None)

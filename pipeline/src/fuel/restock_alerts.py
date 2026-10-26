"""Alerte de réapprovisionnement : prévient un agent (Hermes) par webhook quand
un carburant surveillé redevient disponible dans une station surveillée.

Stations surveillées : les **favorites** (collection `favorite_stations`,
gérée depuis la carte des carburants via le backend), plus, si elle est
configurée, toutes celles d'une **zone** autour d'un point. Sans zone, seules
les favorites déclenchent une alerte.

L'import remplace `fuel_stations` à chaque passage (cf. import_stations.py) :
l'état précédent n'est conservé nulle part. Le passage « en rupture → de
retour » n'est donc visible qu'à un seul moment, pendant l'import, en comparant
la base avant et après. C'est ce que fait ce module, sans rien écrire en base.

Définition retenue : un carburant est **réapprovisionné** s'il était vendu mais
indisponible (`available: false`) à l'import précédent et disponible
(`available: true`) à celui-ci. Une station absente de l'import précédent (une
nouvelle station, ou une station supprimée puis revenue) n'est pas un
réapprovisionnement : rien ne dit qu'elle était en rupture. Un carburant qui
n'était pas vendu du tout ne l'est pas davantage.

Configuration par l'environnement ; sans webhook ni zone, la fonctionnalité
est désactivée et l'import se comporte comme s'il n'existait pas :

- `FUEL_WATCH_LAT`, `FUEL_WATCH_LNG` : centre de la zone surveillée, en degrés
  (facultatif — sans eux, seules les favorites sont surveillées) ;
- `FUEL_WATCH_RADIUS_KM` : rayon de la zone, 5 km par défaut ;
- `FUEL_WATCH_FUELS` : codes surveillés séparés par des virgules, `gazole` par
  défaut ;
- `FUEL_RESTOCK_WEBHOOK_URL` : route webhook de l'agent, par exemple
  `http://192.168.1.10:8644/webhooks/fuel-restock` ;
- `FUEL_RESTOCK_WEBHOOK_SECRET` : secret HMAC partagé avec la route.

Signature : schéma « Generic V2 » du webhook Hermes — en-tête
`X-Webhook-Signature-V2` = HMAC-SHA256 hexadécimal de `<timestamp>.<corps>`,
et `X-Webhook-Timestamp` en secondes Unix. Hermes refuse un horodatage à plus
de 5 minutes de son horloge, ce qui bloque le rejeu d'une requête interceptée.

Un échec d'envoi ne fait jamais échouer l'import : les prix doivent être à jour
même si l'agent est arrêté. L'alerte est alors perdue, et le journal du run
Airflow le dit.
"""
import hashlib
import hmac
import json
import math
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pymongo.collection import Collection
from pymongo.database import Database

DEFAULT_RADIUS_KM = 5.0
DEFAULT_FUELS = ("gazole",)

# Rayon moyen de la Terre (IUGG). L'erreur de la formule de haversine — la
# Terre n'est pas une sphère — reste sous 0,5 %, soit 25 m sur 5 km.
EARTH_RADIUS_KM = 6371.0088

REQUEST_TIMEOUT_SECONDS = 10

FUEL_LABELS = {
    "gazole": "Gazole",
    "e10": "SP95-E10",
    "sp98": "SP98",
    "sp95": "SP95",
    "e85": "E85",
    "gplc": "GPLc",
}


@dataclass(frozen=True)
class RestockWatch:
    # Centre de la zone ; None (les deux) si seules les favorites sont surveillées.
    lat: float | None
    lng: float | None
    radius_km: float
    fuels: tuple[str, ...]
    webhook_url: str | None
    webhook_secret: str | None

    @classmethod
    def from_env(cls, environ) -> "RestockWatch | None":
        """Configuration lue dans l'environnement, ou None si désactivée.

        Une configuration invalide désactive l'alerte avec un message, sans
        lever : une faute de frappe dans une variable ne doit pas bloquer
        l'import des prix de toute la France.
        """
        lat, lng = environ.get("FUEL_WATCH_LAT"), environ.get("FUEL_WATCH_LNG")
        url = environ.get("FUEL_RESTOCK_WEBHOOK_URL")
        if not url and not (lat or lng):
            return None
        if bool(lat) != bool(lng):
            print("restock: FUEL_WATCH_LAT et FUEL_WATCH_LNG vont ensemble, alerte désactivée")
            return None
        try:
            watch = cls(
                lat=float(lat) if lat else None,
                lng=float(lng) if lng else None,
                radius_km=float(environ.get("FUEL_WATCH_RADIUS_KM") or DEFAULT_RADIUS_KM),
                fuels=tuple(
                    code.strip().lower()
                    for code in (environ.get("FUEL_WATCH_FUELS") or ",".join(DEFAULT_FUELS)).split(",")
                    if code.strip()
                ),
                webhook_url=environ.get("FUEL_RESTOCK_WEBHOOK_URL") or None,
                webhook_secret=environ.get("FUEL_RESTOCK_WEBHOOK_SECRET") or None,
            )
        except ValueError as error:
            print(f"restock: configuration illisible ({error}), alerte désactivée")
            return None
        if watch.has_zone and (
            not (-90 <= watch.lat <= 90 and -180 <= watch.lng <= 180) or watch.radius_km <= 0
        ):
            print("restock: zone surveillée hors limites, alerte désactivée")
            return None
        unknown = set(watch.fuels) - set(FUEL_LABELS)
        if unknown or not watch.fuels:
            print(f"restock: carburant(s) inconnu(s) {sorted(unknown)}, alerte désactivée")
            return None
        if watch.webhook_url and not watch.webhook_secret:
            # Hermes rejette une requête non signée dès qu'un secret est
            # configuré côté route ; envoyer sans signature échouerait toujours.
            print("restock: FUEL_RESTOCK_WEBHOOK_SECRET manquant, alerte désactivée")
            return None
        return watch

    @property
    def has_zone(self) -> bool:
        return self.lat is not None and self.lng is not None


def favorite_station_ids(db: Database) -> set[str]:
    """Identifiants des stations favorites, écrites par le backend."""
    return {doc["_id"] for doc in db["favorite_stations"].find({}, {"_id": 1})}


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = phi2 - phi1
    d_lambda = math.radians(lng2 - lng1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def watched_stations(
    collection: Collection, watch: RestockWatch, favorite_ids: set[str]
) -> dict[str, dict]:
    """Stations surveillées — favorites ou dans la zone — par identifiant.

    `distanceKm` est la distance au centre de la zone (favorites hors zone
    comprises), None sans zone. Calculée en Python plutôt qu'avec `$geoNear` :
    une seule passe sur ~10 000 documents réduits à leur position et leurs
    carburants, et le même code tourne sous mongomock, qui ne connaît pas les
    requêtes géographiques.
    """
    stations = {}
    projection = {"location": 1, "fuels": 1, "brand": 1, "name": 1, "address": 1,
                  "city": 1, "postcode": 1}
    for doc in collection.find({}, projection):
        distance = None
        if watch.has_zone:
            lng, lat = doc["location"]["coordinates"]
            distance = haversine_km(watch.lat, watch.lng, lat, lng)
        favorite = doc["_id"] in favorite_ids
        if favorite or (distance is not None and distance <= watch.radius_km):
            stations[doc["_id"]] = {
                **doc,
                "distanceKm": round(distance, 2) if distance is not None else None,
                "favorite": favorite,
            }
    return stations


def detect_restocks(
    before: dict[str, dict], after: dict[str, dict], fuels: tuple[str, ...]
) -> list[dict]:
    """Carburants passés d'indisponible à disponible : favorites d'abord, puis
    du plus proche au plus loin."""
    restocks = []
    for station_id, station in after.items():
        previous = before.get(station_id)
        if previous is None:
            continue
        previous_fuels = {f["code"]: f for f in previous["fuels"]}
        for fuel in station["fuels"]:
            was = previous_fuels.get(fuel["code"])
            if fuel["code"] not in fuels or was is None:
                continue
            if was["available"] is False and fuel["available"] is True:
                restocks.append({
                    "stationId": station_id,
                    "brand": station.get("brand"),
                    "name": station.get("name"),
                    "address": station.get("address"),
                    "postcode": station.get("postcode"),
                    "city": station.get("city"),
                    "favorite": station["favorite"],
                    "distanceKm": station["distanceKm"],
                    "fuel": fuel["code"],
                    "price": fuel["price"],
                    "updatedAt": fuel["updatedAt"],
                    "shortageSince": was.get("shortageSince"),
                })
    return sorted(restocks, key=lambda r: (
        not r["favorite"],
        r["distanceKm"] if r["distanceKm"] is not None else math.inf,
        r["stationId"],
        r["fuel"],
    ))


def _paris_tz():
    # L'image python:*-slim n'embarque pas forcément la base des fuseaux :
    # on retombe alors sur l'UTC, affiché comme tel, plutôt que d'échouer.
    try:
        return ZoneInfo("Europe/Paris"), ""
    except ZoneInfoNotFoundError:
        return timezone.utc, " UTC"


def _local(value: datetime) -> str:
    tz, suffix = _paris_tz()
    local = value.replace(tzinfo=timezone.utc).astimezone(tz)
    return f"{local:%d/%m à %H:%M}{suffix}"


def _decimal(value: float) -> str:
    return f"{value:g}".replace(".", ",")


def format_summary(restocks: list[dict], watch: RestockWatch) -> str:
    """Message prêt à envoyer tel quel (route Hermes en `deliver_only`).

    Un gabarit Hermes ne sait pas boucler sur une liste : le texte est donc
    rendu ici, et la route n'a qu'à afficher `{summary}`.
    """
    stations = {r["stationId"] for r in restocks}
    labels = ", ".join(FUEL_LABELS[code] for code in watch.fuels)
    lines = [f"⛽ {labels} de retour dans {len(stations)} station(s) :"]
    for r in restocks:
        bullet = "★" if r["favorite"] else "•"
        who = r["brand"] or r["name"] or "Station"
        where = ", ".join(p for p in (r["address"], f"{r['postcode']} {r['city']}".strip()) if p)
        price = f"{r['price']:.3f} €".replace(".", ",")
        line = f"{bullet} {FUEL_LABELS[r['fuel']]} — {who}, {where} — {price}"
        if r["distanceKm"] is not None:
            line += f" ({_decimal(r['distanceKm'])} km)"
        if r["shortageSince"] is not None:
            line += f", en rupture depuis le {_local(r['shortageSince'])}"
        lines.append(line)
    return "\n".join(lines)


def _json_default(value):
    if isinstance(value, datetime):
        return value.replace(tzinfo=timezone.utc).isoformat()
    raise TypeError(f"{type(value).__name__} non sérialisable")


def build_payload(restocks: list[dict], watch: RestockWatch, imported_at: datetime) -> dict:
    return {
        # Champ lu par Hermes pour filtrer les routes par `events`.
        "event_type": "fuel_restock",
        "importedAt": imported_at,
        "fuels": list(watch.fuels),
        "zone": (
            {"lat": watch.lat, "lng": watch.lng, "radiusKm": watch.radius_km}
            if watch.has_zone else None
        ),
        "count": len(restocks),
        "summary": format_summary(restocks, watch),
        "restocks": restocks,
    }


def sign(secret: str, timestamp: int, body: bytes) -> str:
    message = f"{timestamp}.".encode() + body
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def send_webhook(url: str, secret: str, payload: dict, request_id: str) -> int:
    """POST signé ; renvoie le statut HTTP, lève sur une erreur réseau ou ≥ 400.

    `X-Request-ID` est dérivé de l'import : Hermes ignore un identifiant déjà
    vu dans l'heure, donc un double envoi du même import ne notifie qu'une fois.
    """
    body = json.dumps(payload, default=_json_default, ensure_ascii=False).encode()
    timestamp = int(time.time())
    request = Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Webhook-Timestamp": str(timestamp),
            "X-Webhook-Signature-V2": sign(secret, timestamp, body),
            "X-Request-ID": request_id,
        },
    )
    with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        return response.status


def alert_restocks(
    watch: RestockWatch, before: dict[str, dict], after: dict[str, dict], imported_at: datetime
) -> list[dict]:
    """Détecte et notifie. Renvoie les réapprovisionnements détectés.

    N'envoie rien s'il n'y en a aucun : l'agent n'est réveillé que pour un
    événement réel. Ne lève jamais — cf. la docstring du module.
    """
    restocks = detect_restocks(before, after, watch.fuels)
    print(f"restock: {len(after)} station(s) surveillée(s), {len(restocks)} réapprovisionnement(s)")
    if not restocks:
        return restocks
    if not watch.webhook_url:
        print("restock: FUEL_RESTOCK_WEBHOOK_URL absent, alerte non envoyée")
        return restocks

    payload = build_payload(restocks, watch, imported_at)
    request_id = f"fuel-restock-{imported_at:%Y%m%dT%H%M%S}"
    try:
        status = send_webhook(watch.webhook_url, watch.webhook_secret, payload, request_id)
        print(f"restock: webhook envoyé (HTTP {status})")
    except Exception as error:  # noqa: BLE001 — l'import des prix prime sur l'alerte
        print(f"restock: échec de l'envoi du webhook ({error}), alerte perdue")
    return restocks

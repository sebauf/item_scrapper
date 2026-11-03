"""Alerte de réapprovisionnement, **par utilisateur** : prévient chaque
utilisateur, par un message sur son téléphone, quand un carburant qu'il
surveille redevient disponible dans l'une de ses stations favorites.

Qui reçoit quoi — trois conditions, toutes écrites par le backend :

- un **numéro** au format E.164 dans son profil (`user_profiles.phone`) ;
- au moins un **carburant** surveillé (`user_profiles.alertFuels`) ;
- au moins une **station favorite** (`favorite_stations`, étoile sur la carte).

Il manque l'une des trois, l'utilisateur n'est pas surveillé du tout. C'est la
même règle que `UserProfile.missingForFuelAlerts` côté backend, qui l'affiche
sur la page de profil ; ici, elle s'applique pour de bon. Une favorite
antérieure aux comptes (sans `userId`) n'appartient à personne et n'alerte
donc personne : le backend la rattache à `AUTH_LEGACY_OWNER_EMAIL` à son
démarrage.

L'import remplace `fuel_stations` à chaque passage (cf. import_stations.py) et
n'en garde aucun historique. Comparer à l'import précédent ne suffit pas : une
station qui clôt ses ruptures sans redéclarer de prix passe par un état « ni
prix, ni rupture », où elle (ou le carburant) disparaît de `fuel_stations` ; au
retour du prix, l'import précédent ne dit plus qu'elle était en rupture. Ce
module tient donc son propre **dernier état connu**, dans `fuel_watch_state`,
qu'il est seul à écrire, pour chaque triplet surveillé (utilisateur × station
favorite × carburant surveillé) : `_id` = `<userId>:<stationId>:<carburant>`,
`available`, `shortageSince`, `seenAt`.

Pourquoi un état par utilisateur, et pas par (station × carburant) partagé :
l'envoi est par utilisateur, et peut échouer pour l'un et réussir pour l'autre
(numéro refusé par la passerelle, par exemple). Un état partagé obligerait à
choisir entre réalerter celui qui a déjà reçu le message et perdre l'alerte de
celui qui ne l'a pas reçue. Le volume reste négligeable (quelques stations ×
quelques carburants par utilisateur).

Définition retenue : un carburant est **réapprovisionné** s'il est disponible
(`available: true`) à cet import et que son dernier état connu est « en
rupture » (`available: false`), quel que soit le nombre d'imports écoulés
entre les deux. Règles de mise à jour, après chaque import :

- carburant présent, disponible ou non → l'état enregistré devient le sien ;
- station absente, carburant absent (non vendu, ou ni prix ni rupture) → rien
  ne change : un état ambigu n'efface jamais le dernier état connu ;
- aucun état enregistré (triplet vu pour la première fois : station mise en
  favori, carburant coché, numéro renseigné) → on l'enregistre sans alerter :
  rien ne dit qu'il était en rupture ;
- triplet qui n'est plus surveillé (favorite retirée, carburant décoché,
  numéro effacé) → son état est supprimé, sans quoi une surveillance reprise
  des mois plus tard alerterait sur un état périmé.

Configuration par l'environnement ; sans webhook, la fonctionnalité est
désactivée et l'import se comporte comme si elle n'existait pas :

- `FUEL_RESTOCK_WEBHOOK_URL` : route webhook de l'agent, par exemple
  `http://192.168.1.10:8644/webhooks/fuel-restock` ;
- `FUEL_RESTOCK_WEBHOOK_SECRET` : secret HMAC partagé avec la route.

Un **webhook par destinataire** et par import, dont le corps porte le numéro
dans `to` (E.164) et le message prêt à envoyer dans `summary`. La route Hermes
correspondante, en `deliver_only` (aucun appel au modèle) :

    deliver: "sms"            # ou whatsapp, signal…
    deliver_only: true
    prompt: "{summary}"
    deliver_extra:
      chat_id: "{to}"

Signature : schéma « Generic V2 » du webhook Hermes — en-tête
`X-Webhook-Signature-V2` = HMAC-SHA256 hexadécimal de `<timestamp>.<corps>`,
et `X-Webhook-Timestamp` en secondes Unix. Hermes refuse un horodatage à plus
de 5 minutes de son horloge, ce qui bloque le rejeu d'une requête interceptée.
La signature est ce qui empêche un tiers d'utiliser la route pour envoyer des
messages à un numéro de son choix : elle est obligatoire.

Un échec d'envoi ne fait jamais échouer l'import : les prix doivent être à jour
même si l'agent est arrêté. Les carburants concernés restent alors « en
rupture » dans l'état **de ce destinataire seulement**, et son alerte repart à
l'import suivant — toutes les 30 minutes tant que l'envoi échoue, ce qui est
préférable à une alerte perdue.
"""
import hashlib
import hmac
import json
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pymongo import ReplaceOne
from pymongo.database import Database

REQUEST_TIMEOUT_SECONDS = 10

FUEL_LABELS = {
    "gazole": "Gazole",
    "e10": "SP95-E10",
    "sp98": "SP98",
    "sp95": "SP95",
    "e85": "E85",
    "gplc": "GPLc",
}
FUEL_ORDER = {code: i for i, code in enumerate(FUEL_LABELS)}

# Même forme que le backend (profile/domain/phone-number.ts), qui normalise à
# la saisie. Revérifiée ici : un numéro écrit à la main dans Mongo ne doit pas
# partir vers la passerelle SMS.
E164 = re.compile(r"^\+[1-9]\d{7,14}$")


@dataclass(frozen=True)
class RestockConfig:
    webhook_url: str
    webhook_secret: str

    @classmethod
    def from_env(cls, environ) -> "RestockConfig | None":
        """Configuration lue dans l'environnement, ou None si désactivée.

        Une configuration incomplète désactive l'alerte avec un message, sans
        lever : une faute de frappe dans une variable ne doit pas bloquer
        l'import des prix de toute la France.
        """
        url = environ.get("FUEL_RESTOCK_WEBHOOK_URL")
        if not url:
            return None
        secret = environ.get("FUEL_RESTOCK_WEBHOOK_SECRET")
        if not secret:
            # Sans signature, n'importe qui pourrait faire envoyer un message
            # à n'importe quel numéro par la route ; Hermes rejette d'ailleurs
            # une requête non signée dès qu'un secret est configuré.
            print("restock: FUEL_RESTOCK_WEBHOOK_SECRET manquant, alerte désactivée")
            return None
        return cls(webhook_url=url, webhook_secret=secret)


@dataclass(frozen=True)
class Subscriber:
    """Un utilisateur qui remplit les trois conditions de l'alerte."""
    user_id: str
    phone: str
    fuels: tuple[str, ...]
    station_ids: frozenset[str]

    def watched(self) -> set[str]:
        return {
            state_id(self.user_id, station_id, fuel)
            for station_id in self.station_ids
            for fuel in self.fuels
        }


def subscribers(db: Database) -> list[Subscriber]:
    """Utilisateurs surveillés : numéro valide, carburant connu, station
    favorite. Triés par identifiant, pour un ordre d'envoi stable."""
    stations_by_user: dict[str, set[str]] = {}
    for doc in db["favorite_stations"].find(
        {"userId": {"$exists": True}}, {"userId": 1, "stationId": 1}
    ):
        if doc.get("stationId"):
            stations_by_user.setdefault(doc["userId"], set()).add(doc["stationId"])

    result = []
    for profile in db["user_profiles"].find({}, {"phone": 1, "alertFuels": 1}):
        user_id, phone = profile["_id"], profile.get("phone")
        fuels = tuple(sorted(
            {code for code in profile.get("alertFuels") or [] if code in FUEL_LABELS},
            key=FUEL_ORDER.__getitem__,
        ))
        station_ids = stations_by_user.get(user_id)
        if not (isinstance(phone, str) and E164.match(phone) and fuels and station_ids):
            continue
        result.append(Subscriber(user_id, phone, fuels, frozenset(station_ids)))
    return sorted(result, key=lambda s: s.user_id)


def state_id(user_id: str, station_id: str, fuel: str) -> str:
    return f"{user_id}:{station_id}:{fuel}"


def detect_restocks(
    subscriber: Subscriber, stations: dict[str, dict], states: dict[str, dict], seen_at: datetime
) -> tuple[list[dict], list[dict]]:
    """Compare les stations favorites d'un utilisateur au dernier état connu
    pour lui.

    Renvoie ses réapprovisionnements — par station, puis dans l'ordre des
    carburants — et les nouveaux états à enregistrer. Seuls les carburants
    présents produisent un état : un absent laisse l'ancien en place.
    """
    restocks, updates = [], []
    for station_id in sorted(subscriber.station_ids):
        station = stations.get(station_id)
        if station is None:
            continue
        for fuel in station["fuels"]:
            if fuel["code"] not in subscriber.fuels:
                continue
            key = state_id(subscriber.user_id, station_id, fuel["code"])
            known = states.get(key)
            was_short = known is not None and known["available"] is False
            if fuel["available"] and was_short:
                restocks.append({
                    "stationId": station_id,
                    "brand": station.get("brand"),
                    "name": station.get("name"),
                    "address": station.get("address"),
                    "postcode": station.get("postcode"),
                    "city": station.get("city"),
                    "fuel": fuel["code"],
                    "price": fuel["price"],
                    "updatedAt": fuel["updatedAt"],
                    "shortageSince": known.get("shortageSince"),
                })
            shortage_since = None
            if not fuel["available"]:
                # Une rupture déclarée sans date garde celle déjà connue.
                shortage_since = fuel.get("shortageSince") or (
                    known.get("shortageSince") if was_short else None
                )
            updates.append({
                "_id": key,
                "userId": subscriber.user_id,
                "stationId": station_id,
                "fuel": fuel["code"],
                "available": fuel["available"],
                "shortageSince": shortage_since,
                "seenAt": seen_at,
            })
    restocks.sort(key=lambda r: (r["stationId"], FUEL_ORDER[r["fuel"]]))
    return restocks, updates


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


def format_summary(restocks: list[dict]) -> str:
    """Message prêt à envoyer tel quel (route Hermes en `deliver_only`).

    Un gabarit Hermes ne sait pas boucler sur une liste : le texte est donc
    rendu ici, et la route n'a qu'à afficher `{summary}`. Court, parce qu'il
    part souvent par SMS.
    """
    stations = {r["stationId"] for r in restocks}
    fuels = sorted({r["fuel"] for r in restocks}, key=FUEL_ORDER.__getitem__)
    labels = ", ".join(FUEL_LABELS[code] for code in fuels)
    lines = [f"⛽ {labels} de retour dans {len(stations)} station(s) favorite(s) :"]
    for r in restocks:
        who = r["brand"] or r["name"] or "Station"
        where = ", ".join(p for p in (r["address"], f"{r['postcode']} {r['city']}".strip()) if p)
        price = f"{r['price']:.3f} €".replace(".", ",")
        line = f"• {FUEL_LABELS[r['fuel']]} — {who}, {where} — {price}"
        if r["shortageSince"] is not None:
            line += f", en rupture depuis le {_local(r['shortageSince'])}"
        lines.append(line)
    return "\n".join(lines)


def _json_default(value):
    if isinstance(value, datetime):
        return value.replace(tzinfo=timezone.utc).isoformat()
    raise TypeError(f"{type(value).__name__} non sérialisable")


def build_payload(subscriber: Subscriber, restocks: list[dict], imported_at: datetime) -> dict:
    """Corps du webhook. L'adresse e-mail de l'utilisateur n'y figure pas :
    l'agent n'a besoin que du numéro où envoyer le message."""
    return {
        # Champ lu par Hermes pour filtrer les routes par `events`.
        "event_type": "fuel_restock",
        "importedAt": imported_at,
        # Destinataire, au format E.164 — `deliver_extra.chat_id: "{to}"`.
        "to": subscriber.phone,
        "fuels": list(subscriber.fuels),
        "count": len(restocks),
        "summary": format_summary(restocks),
        "restocks": restocks,
    }


def sign(secret: str, timestamp: int, body: bytes) -> str:
    message = f"{timestamp}.".encode() + body
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def request_id(subscriber: Subscriber, imported_at: datetime) -> str:
    """Dérivé de l'import **et** du destinataire : Hermes ignore un
    identifiant déjà vu dans l'heure, donc un double envoi du même import ne
    notifie qu'une fois, sans pour autant confondre deux destinataires.
    L'utilisateur y figure haché — l'en-tête finit dans les journaux de
    l'agent. Le renvoi d'une alerte échouée, à l'import suivant, porte un
    nouvel identifiant : c'est voulu, Hermes ne doit pas le dédupliquer.
    """
    user = hashlib.sha256(subscriber.user_id.encode()).hexdigest()[:12]
    return f"fuel-restock-{imported_at:%Y%m%dT%H%M%S}-{user}"


def send_webhook(url: str, secret: str, payload: dict, request_id: str) -> int:
    """POST signé ; renvoie le statut HTTP, lève sur une erreur réseau ou ≥ 400."""
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


def mask_phone(phone: str) -> str:
    """`+33612345678` → `+33•••••5678` : assez pour s'y retrouver dans les
    journaux d'Airflow, sans y recopier les numéros."""
    return phone[:3] + "•" * max(len(phone) - 7, 0) + phone[-4:]


def alert_restocks(db: Database, config: RestockConfig, imported_at: datetime) -> dict[str, list[dict]]:
    """Détecte, notifie chaque destinataire, puis met à jour
    `fuel_watch_state`. Renvoie les réapprovisionnements détectés, par
    utilisateur (seuls ceux qui en ont un).

    À appeler une fois, après l'import. N'envoie rien à un utilisateur sans
    réapprovisionnement : il n'est dérangé que pour un événement réel. Ne lève
    jamais sur un échec d'envoi — cf. la docstring du module.
    """
    collection = db["fuel_watch_state"]
    subs = subscribers(db)
    station_ids = sorted({sid for sub in subs for sid in sub.station_ids})
    projection = {"fuels": 1, "brand": 1, "name": 1, "address": 1, "city": 1, "postcode": 1}
    stations = {
        doc["_id"]: doc
        for doc in db["fuel_stations"].find({"_id": {"$in": station_ids}}, projection)
    }
    states = {doc["_id"]: doc for doc in collection.find({})}

    watched: set[str] = set()
    all_updates: list[dict] = []
    detected: dict[str, list[dict]] = {}
    sent = failed = 0
    for sub in subs:
        watched |= sub.watched()
        restocks, updates = detect_restocks(sub, stations, states, imported_at)
        if restocks:
            detected[sub.user_id] = restocks
            payload = build_payload(sub, restocks, imported_at)
            try:
                status = send_webhook(
                    config.webhook_url, config.webhook_secret, payload, request_id(sub, imported_at)
                )
                sent += 1
                print(f"restock: alerte envoyée à {mask_phone(sub.phone)} (HTTP {status})")
            except Exception as error:  # noqa: BLE001 — l'import des prix prime sur l'alerte
                failed += 1
                print(f"restock: échec de l'envoi à {mask_phone(sub.phone)} ({error}), "
                      "nouvel essai au prochain import")
                # Ces carburants restent « en rupture » pour lui : l'alerte repartira.
                unsent = {state_id(sub.user_id, r["stationId"], r["fuel"]) for r in restocks}
                updates = [u for u in updates if u["_id"] not in unsent]
        all_updates.extend(updates)

    stale = sorted(set(states) - watched)
    print(f"restock: {len(subs)} destinataire(s), {len(watched)} couple(s) station × carburant "
          f"surveillé(s), {sent} alerte(s) envoyée(s), {failed} échec(s)")

    if all_updates:
        collection.bulk_write([ReplaceOne({"_id": u["_id"]}, u, upsert=True) for u in all_updates])
    if stale:
        # Y compris les états de l'ancienne alerte globale (`<station>:<carburant>`,
        # sans `userId`), qui ne correspondent plus à aucun triplet.
        collection.delete_many({"_id": {"$in": stale}})
    return detected

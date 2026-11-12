"""Alertes carburant, **par utilisateur** : préviennent chaque utilisateur,
par un message sur son téléphone, de ce qui arrive à un carburant qu'il
surveille dans l'une de ses stations favorites. Trois événements :

- **réapprovisionnement** (`fuel_restock`) : le carburant redevient disponible ;
- **rupture** (`fuel_shortage`) : il tombe en rupture ;
- **risque de rupture** (`fuel_shortage_risk`) : le modèle de
  `shortage_forecast` prévoit une rupture dans les 24 h avec une probabilité
  d'au moins `FUEL_SHORTAGE_RISK_THRESHOLD` (0,5 par défaut). Au plus une
  alerte par jour et par (station × carburant), et seulement si le modèle en
  service a moins de 7 jours. Sans modèle, les deux autres alertes continuent.

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
entre les deux ; il est **en rupture** dans le cas inverse. L'état garde aussi
`riskAlertedAt`, la date de la dernière alerte de risque. Règles de mise à
jour, après chaque import :

- carburant présent, disponible ou non → l'état enregistré devient le sien ;
- station absente, carburant absent (non vendu) → rien ne change : un état
  ambigu n'efface jamais le dernier état connu. Un carburant vendu qui passe à
  « ni prix ni rupture » n'est plus absent : l'import le garde **en rupture
  présumée** pendant 7 jours (cf. import_stations.py), il compte donc comme
  une rupture ;
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

Un **webhook par destinataire, par type d'événement** et par import, dont le
corps porte le numéro dans `to` (E.164), le message prêt à envoyer dans
`summary`, et le type dans `event_type` — une route Hermes filtre sur ce champ
(`events`) : ajoutez-y `fuel_shortage` et `fuel_shortage_risk`, ou créez une
route par type. La route Hermes
correspondante, en `deliver_only` (aucun appel au modèle) :

    deliver: "sms"            # ou signal
    deliver_only: true
    prompt: "{summary}"
    deliver_extra:
      chat_id: "{to}"

Pour WhatsApp, `deliver: "whatsapp"` et `chat_id: "{whatsappChatId}"` : le
pont de Hermes désigne une discussion par `33612345678@s.whatsapp.net`, pas
par le numéro E.164.

Signature : schéma « Generic V2 » du webhook Hermes — en-tête
`X-Webhook-Signature-V2` = HMAC-SHA256 hexadécimal de `<timestamp>.<corps>`,
et `X-Webhook-Timestamp` en secondes Unix. Hermes refuse un horodatage à plus
de 5 minutes de son horloge, ce qui bloque le rejeu d'une requête interceptée.
La signature est ce qui empêche un tiers d'utiliser la route pour envoyer des
messages à un numéro de son choix : elle est obligatoire.

Un échec d'envoi ne fait jamais échouer l'import : les prix doivent être à jour
même si l'agent est arrêté. L'état des triplets concernés reste alors celui
d'avant (« en rupture » pour un réapprovisionnement, « disponible » pour une
rupture, pas de `riskAlertedAt` pour un risque) dans l'état **de ce
destinataire seulement**, et son alerte repart à l'import suivant — toutes les
30 minutes tant que l'envoi échoue, ce qui est préférable à une alerte perdue.
"""
import hashlib
import hmac
import json
import re
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pymongo import ReplaceOne
from pymongo.database import Database

from src.fuel.favorites import favorite_stations_by_user
from src.fuel.fuels import FUEL_LABELS, FUEL_RANK

REQUEST_TIMEOUT_SECONDS = 10


# Même forme que le backend (profile/domain/phone-number.ts), qui normalise à
# la saisie. Revérifiée ici : un numéro écrit à la main dans Mongo ne doit pas
# partir vers la passerelle SMS.
E164 = re.compile(r"^\+[1-9]\d{7,14}$")


# Seuil de l'alerte de risque, réglable par FUEL_SHORTAGE_RISK_THRESHOLD. À
# 50 %, la validation d'octobre-novembre 2026 donnait : 56 % des alertes
# suivies d'une rupture dans les 24 h, 45 % des ruptures annoncées à l'avance.
# Plus haut, moins d'alertes mais plus sûres ; plus bas, l'inverse.
DEFAULT_RISK_THRESHOLD = 0.5


@dataclass(frozen=True)
class RestockConfig:
    webhook_url: str
    webhook_secret: str
    # None : alerte de risque désactivée (les deux autres restent actives).
    risk_threshold: float | None = DEFAULT_RISK_THRESHOLD

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
        return cls(webhook_url=url, webhook_secret=secret,
                   risk_threshold=_risk_threshold(environ.get("FUEL_SHORTAGE_RISK_THRESHOLD")))


def _risk_threshold(raw: str | None) -> float | None:
    """`off` désactive l'alerte de risque ; une valeur hors de ]0, 1[ garde
    le défaut, avec un message, plutôt que d'alerter à tout propos (0) ou
    jamais (1)."""
    if raw is None or raw.strip() == "":
        return DEFAULT_RISK_THRESHOLD
    if raw.strip().lower() in ("off", "false", "none"):
        return None
    try:
        value = float(raw.replace(",", "."))
    except ValueError:
        value = -1
    if not 0 < value < 1:
        print(f"shortage-risk: FUEL_SHORTAGE_RISK_THRESHOLD={raw!r} invalide (attendu entre 0 et 1 "
              f"exclus, ou off), seuil par défaut {DEFAULT_RISK_THRESHOLD}")
        return DEFAULT_RISK_THRESHOLD
    return value


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
    stations_by_user = favorite_stations_by_user(db)
    result = []
    for profile in db["user_profiles"].find({}, {"phone": 1, "alertFuels": 1}):
        user_id, phone = profile["_id"], profile.get("phone")
        fuels = tuple(sorted(
            {code for code in profile.get("alertFuels") or [] if code in FUEL_LABELS},
            key=FUEL_RANK.__getitem__,
        ))
        station_ids = stations_by_user.get(user_id)
        if not (isinstance(phone, str) and E164.match(phone) and fuels and station_ids):
            continue
        result.append(Subscriber(user_id, phone, fuels, frozenset(station_ids)))
    return sorted(result, key=lambda s: s.user_id)


def state_id(user_id: str, station_id: str, fuel: str) -> str:
    return f"{user_id}:{station_id}:{fuel}"


# Les trois événements, dans l'ordre où on les envoie. Chacun part dans son
# propre webhook (`event_type` distinct), pour qu'une route Hermes puisse les
# filtrer ou les acheminer différemment.
RESTOCK, SHORTAGE, RISK = "restock", "shortage", "risk"
EVENT_TYPES = {RESTOCK: "fuel_restock", SHORTAGE: "fuel_shortage", RISK: "fuel_shortage_risk"}

# Une alerte de risque par (utilisateur × station × carburant) et par jour au
# plus : une station souvent à sec resterait sinon « à risque » à chaque import,
# soit 48 messages par jour.
RISK_ALERT_COOLDOWN = timedelta(hours=24)


def _event(station_id: str, station: dict, fuel: dict, **extra) -> dict:
    return {
        "stationId": station_id,
        "brand": station.get("brand"),
        "name": station.get("name"),
        "address": station.get("address"),
        "postcode": station.get("postcode"),
        "city": station.get("city"),
        "fuel": fuel["code"],
        "price": fuel["price"],
        "updatedAt": fuel["updatedAt"],
        **extra,
    }


def detect_events(
    subscriber: Subscriber,
    stations: dict[str, dict],
    states: dict[str, dict],
    seen_at: datetime,
    risks: dict[tuple[str, str], float] | None = None,
    risk_threshold: float | None = None,
) -> tuple[dict[str, list[dict]], dict[str, dict]]:
    """Compare les stations favorites d'un utilisateur au dernier état connu
    pour lui.

    Renvoie ses événements par type — par station, puis dans l'ordre des
    carburants — et les nouveaux états à enregistrer, par `_id`. Seuls les
    carburants présents produisent un état : un absent laisse l'ancien en place.

    - **réapprovisionnement** : disponible, dernier état connu « en rupture » ;
    - **rupture** : en rupture, dernier état connu « disponible » ;
    - **risque** : disponible, risque prévu ≥ seuil, pas d'alerte de risque
      depuis 24 h, et pas de réapprovisionnement à cet import (on vient
      d'annoncer son retour : un second message dans la même minute brouille).

    Un triplet vu pour la première fois n'alerte jamais : on ne sait pas d'où
    il vient.
    """
    events: dict[str, list[dict]] = {RESTOCK: [], SHORTAGE: [], RISK: []}
    updates: dict[str, dict] = {}
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
            was_available = known is not None and known["available"] is True
            risk_alerted_at = known.get("riskAlertedAt") if known else None

            if fuel["available"] and was_short:
                events[RESTOCK].append(_event(station_id, station, fuel,
                                              shortageSince=known.get("shortageSince")))
            elif not fuel["available"] and was_available:
                events[SHORTAGE].append(_event(station_id, station, fuel,
                                               shortageSince=fuel.get("shortageSince")))
            elif fuel["available"] and known is not None and risk_threshold is not None:
                risk = (risks or {}).get((station_id, fuel["code"]))
                cooled_down = risk_alerted_at is None or seen_at - risk_alerted_at >= RISK_ALERT_COOLDOWN
                if risk is not None and risk >= risk_threshold and cooled_down:
                    events[RISK].append(_event(station_id, station, fuel, risk=round(risk, 3)))
                    risk_alerted_at = seen_at

            shortage_since = None
            if not fuel["available"]:
                # Une rupture déclarée sans date garde celle déjà connue.
                shortage_since = fuel.get("shortageSince") or (
                    known.get("shortageSince") if was_short else None
                )
            updates[key] = {
                "_id": key,
                "userId": subscriber.user_id,
                "stationId": station_id,
                "fuel": fuel["code"],
                "available": fuel["available"],
                "shortageSince": shortage_since,
                "riskAlertedAt": risk_alerted_at,
                "seenAt": seen_at,
            }
    for kind in events:
        events[kind].sort(key=lambda r: (r["stationId"], FUEL_RANK[r["fuel"]]))
    return events, updates


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


def _station_line(r: dict) -> str:
    who = r["brand"] or r["name"] or "Station"
    where = ", ".join(p for p in (r["address"], f"{r['postcode']} {r['city']}".strip()) if p)
    return f"• {FUEL_LABELS[r['fuel']]} — {who}, {where}"


def _fuel_labels(events: list[dict]) -> str:
    fuels = sorted({r["fuel"] for r in events}, key=FUEL_RANK.__getitem__)
    return ", ".join(FUEL_LABELS[code] for code in fuels)


def format_summary(restocks: list[dict]) -> str:
    """Message prêt à envoyer tel quel (route Hermes en `deliver_only`).

    Un gabarit Hermes ne sait pas boucler sur une liste : le texte est donc
    rendu ici, et la route n'a qu'à afficher `{summary}`. Court, parce qu'il
    part souvent par SMS.
    """
    stations = {r["stationId"] for r in restocks}
    lines = [f"⛽ {_fuel_labels(restocks)} de retour dans {len(stations)} station(s) favorite(s) :"]
    for r in restocks:
        price = f"{r['price']:.3f} €".replace(".", ",")
        line = f"{_station_line(r)} — {price}"
        if r["shortageSince"] is not None:
            line += f", en rupture depuis le {_local(r['shortageSince'])}"
        lines.append(line)
    return "\n".join(lines)


def format_shortage_summary(shortages: list[dict]) -> str:
    stations = {r["stationId"] for r in shortages}
    lines = [f"⛔ Rupture de {_fuel_labels(shortages)} dans {len(stations)} station(s) favorite(s) :"]
    for r in shortages:
        line = _station_line(r)
        if r["shortageSince"] is not None:
            line += f" — depuis le {_local(r['shortageSince'])}"
        lines.append(line)
    return "\n".join(lines)


def format_risk_summary(risks: list[dict]) -> str:
    """Le risque est une probabilité calibrée : « 60 % » veut dire qu'en
    situation comparable, une rupture a suivi dans 6 cas sur 10. Le message le
    dit en clair, sans promettre de certitude."""
    stations = {r["stationId"] for r in risks}
    lines = [f"⚠️ Risque de rupture de {_fuel_labels(risks)} dans les 24 h, "
             f"{len(stations)} station(s) favorite(s) :"]
    for r in risks:
        lines.append(f"{_station_line(r)} — risque estimé {round(r['risk'] * 100)} %")
    lines.append("Prévision statistique, pas une certitude : faites le plein si vous le pouvez.")
    return "\n".join(lines)


SUMMARIES = {RESTOCK: format_summary, SHORTAGE: format_shortage_summary, RISK: format_risk_summary}
# Clé de la liste détaillée dans le corps du webhook.
PAYLOAD_LISTS = {RESTOCK: "restocks", SHORTAGE: "shortages", RISK: "risks"}


def _json_default(value):
    if isinstance(value, datetime):
        return value.replace(tzinfo=timezone.utc).isoformat()
    raise TypeError(f"{type(value).__name__} non sérialisable")


def whatsapp_chat_id(phone: str) -> str:
    """`+33612345678` → `33612345678@s.whatsapp.net`.

    Un gabarit Hermes ne sait que recopier un champ, pas le transformer : la
    conversion est donc faite ici, une fois pour toutes les routes WhatsApp.
    """
    return f"{phone.removeprefix('+')}@s.whatsapp.net"


def build_payload(subscriber: Subscriber, events: list[dict], imported_at: datetime, kind: str = RESTOCK) -> dict:
    """Corps du webhook. L'adresse e-mail de l'utilisateur n'y figure pas :
    l'agent n'a besoin que du numéro où envoyer le message."""
    return {
        # Champ lu par Hermes pour filtrer les routes par `events`.
        "event_type": EVENT_TYPES[kind],
        "importedAt": imported_at,
        # Destinataire, au format E.164 — `deliver_extra.chat_id: "{to}"`
        # pour le SMS (Twilio) ou Signal.
        "to": subscriber.phone,
        # Même destinataire, sous la forme d'un identifiant de discussion
        # WhatsApp (pont Baileys de Hermes : indicatif sans « + », suffixe
        # `@s.whatsapp.net`) — `deliver_extra.chat_id: "{whatsappChatId}"`.
        "whatsappChatId": whatsapp_chat_id(subscriber.phone),
        "fuels": list(subscriber.fuels),
        "count": len(events),
        "summary": SUMMARIES[kind](events),
        PAYLOAD_LISTS[kind]: events,
    }


def sign(secret: str, timestamp: int, body: bytes) -> str:
    message = f"{timestamp}.".encode() + body
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def request_id(subscriber: Subscriber, imported_at: datetime, kind: str = RESTOCK) -> str:
    """Dérivé de l'import **et** du destinataire : Hermes ignore un
    identifiant déjà vu dans l'heure, donc un double envoi du même import ne
    notifie qu'une fois, sans pour autant confondre deux destinataires.
    Le type d'événement aussi : une rupture et un risque du même import sont
    deux messages. L'utilisateur y figure haché — l'en-tête finit dans les journaux de
    l'agent. Le renvoi d'une alerte échouée, à l'import suivant, porte un
    nouvel identifiant : c'est voulu, Hermes ne doit pas le dédupliquer.
    """
    user = hashlib.sha256(subscriber.user_id.encode()).hexdigest()[:12]
    slug = EVENT_TYPES[kind].removeprefix("fuel_").replace("_", "-")
    return f"fuel-{slug}-{imported_at:%Y%m%dT%H%M%S}-{user}"


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


def _revert(kind: str, events: list[dict], sub: Subscriber, updates: dict[str, dict], states: dict[str, dict]):
    """Après un échec d'envoi : remet l'état de ces triplets tel qu'il était,
    pour que l'alerte reparte au prochain import."""
    for event in events:
        key = state_id(sub.user_id, event["stationId"], event["fuel"])
        if kind == RISK:
            updates[key]["riskAlertedAt"] = (states.get(key) or {}).get("riskAlertedAt")
        else:
            # Réapprovisionnement : il reste « en rupture » ; rupture : il
            # reste « disponible ». Dans les deux cas, l'ancien état.
            updates.pop(key, None)


def alert_fuel_events(
    db: Database,
    config: RestockConfig,
    imported_at: datetime,
    risks: dict[tuple[str, str], float] | None = None,
) -> dict[str, dict[str, list[dict]]]:
    """Détecte, notifie chaque destinataire, puis met à jour
    `fuel_watch_state`. Renvoie les événements détectés, par utilisateur puis
    par type (seuls les utilisateurs et les types non vides).

    `risks` : risque de rupture à 24 h par (station, carburant), cf.
    `shortage_forecast.forecasts` ; None (pas de modèle) → pas d'alerte de risque.

    À appeler une fois, après l'import. N'envoie rien à un utilisateur sans
    événement : il n'est dérangé que pour un fait nouveau. Ne lève jamais sur
    un échec d'envoi — cf. la docstring du module.
    """
    collection = db["fuel_watch_state"]
    subs = subscribers(db)
    stations = watched_stations(db, subs)
    states = {doc["_id"]: doc for doc in collection.find({})}
    threshold = config.risk_threshold if risks is not None else None

    watched: set[str] = set()
    all_updates: list[dict] = []
    detected: dict[str, dict[str, list[dict]]] = {}
    sent = failed = 0
    for sub in subs:
        watched |= sub.watched()
        events, updates = detect_events(sub, stations, states, imported_at, risks, threshold)
        for kind, kind_events in events.items():
            if not kind_events:
                continue
            detected.setdefault(sub.user_id, {})[kind] = kind_events
            payload = build_payload(sub, kind_events, imported_at, kind)
            try:
                status = send_webhook(
                    config.webhook_url, config.webhook_secret, payload, request_id(sub, imported_at, kind)
                )
                sent += 1
                print(f"{EVENT_TYPES[kind]}: alerte envoyée à {mask_phone(sub.phone)} (HTTP {status})")
            except Exception as error:  # noqa: BLE001 — l'import des prix prime sur l'alerte
                failed += 1
                print(f"{EVENT_TYPES[kind]}: échec de l'envoi à {mask_phone(sub.phone)} ({error}), "
                      "nouvel essai au prochain import")
                _revert(kind, kind_events, sub, updates, states)
        all_updates.extend(updates.values())

    stale = sorted(set(states) - watched)
    print(f"alertes carburant: {len(subs)} destinataire(s), {len(watched)} couple(s) station × carburant "
          f"surveillé(s), {sent} alerte(s) envoyée(s), {failed} échec(s)")

    if all_updates:
        collection.bulk_write([ReplaceOne({"_id": u["_id"]}, u, upsert=True) for u in all_updates])
    if stale:
        # Y compris les états de l'ancienne alerte globale (`<station>:<carburant>`,
        # sans `userId`), qui ne correspondent plus à aucun triplet.
        collection.delete_many({"_id": {"$in": stale}})
    return detected


def watched_stations(db: Database, subs: list[Subscriber]) -> dict[str, dict]:
    station_ids = sorted({sid for sub in subs for sid in sub.station_ids})
    projection = {"fuels": 1, "brand": 1, "name": 1, "address": 1, "city": 1, "postcode": 1}
    return {
        doc["_id"]: doc
        for doc in db["fuel_stations"].find({"_id": {"$in": station_ids}}, projection)
    }

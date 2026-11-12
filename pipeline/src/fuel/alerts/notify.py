"""L'enchaînement, après chaque import : détecter, envoyer, enregistrer l'état."""
from datetime import datetime

from pymongo import ReplaceOne
from pymongo.collection import Collection
from pymongo.database import Database

from src.fuel.alerts.config import FuelAlertConfig
from src.fuel.alerts.detection import EVENT_TYPES, RISK, RiskForecast, detect_events
from src.fuel.alerts.subscribers import Subscriber, load_subscribers, mask_phone, state_id
from src.fuel.alerts.webhook import build_payload, request_id, send_webhook

STATE_COLLECTION = "fuel_watch_state"


def alert_fuel_events(
    db: Database,
    config: FuelAlertConfig,
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
    un échec d'envoi — cf. la docstring du paquet.
    """
    collection = db[STATE_COLLECTION]
    subscribers = load_subscribers(db)
    stations = watched_stations(db, subscribers)
    states = {doc["_id"]: doc for doc in collection.find({})}
    risk = _risk_forecast(risks, config)

    detected: dict[str, dict[str, list[dict]]] = {}
    new_states: list[dict] = []
    sent = failed = 0
    for subscriber in subscribers:
        events, updates = detect_events(subscriber, stations, states, imported_at, risk)
        for kind, kind_events in events.items():
            if not kind_events:
                continue
            detected.setdefault(subscriber.user_id, {})[kind] = kind_events
            if _notify(config, subscriber, kind, kind_events, imported_at):
                sent += 1
            else:
                failed += 1
                updates = _keep_previous_states(kind, kind_events, subscriber.user_id, updates, states)
        new_states.extend(updates.values())

    watched = set().union(*(subscriber.watched_state_ids() for subscriber in subscribers))
    print(f"alertes carburant: {len(subscribers)} destinataire(s), {len(watched)} couple(s) station × "
          f"carburant surveillé(s), {sent} alerte(s) envoyée(s), {failed} échec(s)")
    _save_states(collection, new_states, stale_ids=sorted(set(states) - watched))
    return detected


def watched_stations(db: Database, subscribers: list[Subscriber]) -> dict[str, dict]:
    station_ids = sorted({sid for subscriber in subscribers for sid in subscriber.station_ids})
    projection = {"fuels": 1, "brand": 1, "name": 1, "address": 1, "city": 1, "postcode": 1}
    return {
        doc["_id"]: doc
        for doc in db["fuel_stations"].find({"_id": {"$in": station_ids}}, projection)
    }


def _risk_forecast(
    risks: dict[tuple[str, str], float] | None, config: FuelAlertConfig
) -> RiskForecast | None:
    """Sans prévision publiée, ou alerte de risque désactivée : pas de risque."""
    if risks is None or config.risk_threshold is None:
        return None
    return RiskForecast(risks, config.risk_threshold)


def _notify(
    config: FuelAlertConfig, subscriber: Subscriber, kind: str, events: list[dict], imported_at: datetime
) -> bool:
    """Envoie un webhook ; renvoie False, sans lever, si l'envoi échoue."""
    label, phone = EVENT_TYPES[kind], mask_phone(subscriber.phone)
    payload = build_payload(subscriber, events, imported_at, kind)
    try:
        status = send_webhook(
            config.webhook_url, config.webhook_secret, payload, request_id(subscriber, imported_at, kind)
        )
    except Exception as error:  # noqa: BLE001 — l'import des prix prime sur l'alerte
        print(f"{label}: échec de l'envoi à {phone} ({error}), nouvel essai au prochain import")
        return False
    print(f"{label}: alerte envoyée à {phone} (HTTP {status})")
    return True


def _keep_previous_states(
    kind: str, events: list[dict], user_id: str, updates: dict[str, dict], states: dict[str, dict]
) -> dict[str, dict]:
    """Les états à enregistrer après l'échec d'envoi de `events` : ces
    triplets gardent leur état d'avant, pour que l'alerte reparte au prochain
    import."""
    kept = dict(updates)
    for event in events:
        key = state_id(user_id, event["stationId"], event["fuel"])
        if kind == RISK:
            kept[key] = {**kept[key], "riskAlertedAt": (states.get(key) or {}).get("riskAlertedAt")}
        else:
            # Réapprovisionnement : il reste « en rupture » ; rupture : il
            # reste « disponible ». Dans les deux cas, l'ancien état.
            kept.pop(key, None)
    return kept


def _save_states(collection: Collection, new_states: list[dict], stale_ids: list[str]) -> None:
    if new_states:
        collection.bulk_write([ReplaceOne({"_id": s["_id"]}, s, upsert=True) for s in new_states])
    if stale_ids:
        # Y compris les états de l'ancienne alerte globale (`<station>:<carburant>`,
        # sans `userId`), qui ne correspondent plus à aucun triplet.
        collection.delete_many({"_id": {"$in": stale_ids}})

"""Détection des événements d'un utilisateur — règle pure, sans I/O.

Compare ce que l'import vient de voir au dernier état connu pour cet
utilisateur, et décide de l'événement à annoncer et de l'état à enregistrer.
"""
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime, timedelta

from src.fuel.alerts.subscribers import Subscriber, state_id
from src.fuel.fuels import FUEL_RANK

# Les trois événements, dans l'ordre où on les envoie. Chacun part dans son
# propre webhook (`event_type` distinct), pour qu'une route Hermes puisse les
# filtrer ou les acheminer différemment.
RESTOCK, SHORTAGE, RISK = "restock", "shortage", "risk"
KINDS = (RESTOCK, SHORTAGE, RISK)
EVENT_TYPES = {RESTOCK: "fuel_restock", SHORTAGE: "fuel_shortage", RISK: "fuel_shortage_risk"}

# Une alerte de risque par (utilisateur × station × carburant) et par jour au
# plus : une station souvent à sec resterait sinon « à risque » à chaque import,
# soit 48 messages par jour.
RISK_ALERT_COOLDOWN = timedelta(hours=24)


@dataclass(frozen=True)
class RiskForecast:
    """Risque de rupture à 24 h par (station, carburant), et seuil d'alerte."""
    risks: dict[tuple[str, str], float]
    threshold: float

    def alarming_risk(self, station_id: str, fuel: str) -> float | None:
        """Le risque prévu s'il atteint le seuil, sinon None."""
        risk = self.risks.get((station_id, fuel))
        return risk if risk is not None and risk >= self.threshold else None


@dataclass(frozen=True)
class _Observation:
    """Un triplet surveillé : ce que l'import en voit, et son dernier état connu."""
    user_id: str
    station_id: str
    station: dict
    fuel: dict
    known: dict | None

    @property
    def key(self) -> str:
        return state_id(self.user_id, self.station_id, self.fuel["code"])

    @property
    def was_short(self) -> bool:
        return self.known is not None and self.known["available"] is False

    @property
    def was_available(self) -> bool:
        return self.known is not None and self.known["available"] is True


def detect_events(
    subscriber: Subscriber,
    stations: dict[str, dict],
    states: dict[str, dict],
    seen_at: datetime,
    risk: RiskForecast | None = None,
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
      `risk` à None : pas d'alerte de risque.

    Un triplet vu pour la première fois n'alerte jamais : on ne sait pas d'où
    il vient.
    """
    events: dict[str, list[dict]] = {kind: [] for kind in KINDS}
    updates: dict[str, dict] = {}
    for observation in _observations(subscriber, stations, states):
        detected = _detect(observation, seen_at, risk)
        if detected is not None:
            kind, event = detected
            events[kind].append(event)
        risk_alerted = detected is not None and detected[0] == RISK
        updates[observation.key] = _next_state(observation, seen_at, risk_alerted)
    for kind_events in events.values():
        kind_events.sort(key=lambda r: (r["stationId"], FUEL_RANK[r["fuel"]]))
    return events, updates


def _observations(
    subscriber: Subscriber, stations: dict[str, dict], states: dict[str, dict]
) -> Iterator[_Observation]:
    """Les carburants surveillés présents à cet import, station par station."""
    for station_id in sorted(subscriber.station_ids):
        station = stations.get(station_id)
        if station is None:
            continue
        for fuel in station["fuels"]:
            if fuel["code"] in subscriber.fuels:
                key = state_id(subscriber.user_id, station_id, fuel["code"])
                yield _Observation(subscriber.user_id, station_id, station, fuel, states.get(key))


def _detect(
    observation: _Observation, seen_at: datetime, risk: RiskForecast | None
) -> tuple[str, dict] | None:
    """L'événement à annoncer pour ce triplet, au plus un."""
    fuel = observation.fuel
    if fuel["available"] and observation.was_short:
        return RESTOCK, _event(observation, shortageSince=observation.known.get("shortageSince"))
    if not fuel["available"] and observation.was_available:
        return SHORTAGE, _event(observation, shortageSince=fuel.get("shortageSince"))
    if fuel["available"] and observation.known is not None and risk is not None:
        alarming = risk.alarming_risk(observation.station_id, fuel["code"])
        if alarming is not None and _risk_cooled_down(observation.known, seen_at):
            return RISK, _event(observation, risk=round(alarming, 3))
    return None


def _risk_cooled_down(known: dict, seen_at: datetime) -> bool:
    last_alert = known.get("riskAlertedAt")
    return last_alert is None or seen_at - last_alert >= RISK_ALERT_COOLDOWN


def _event(observation: _Observation, **extra) -> dict:
    station, fuel = observation.station, observation.fuel
    return {
        "stationId": observation.station_id,
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


def _next_state(observation: _Observation, seen_at: datetime, risk_alerted: bool) -> dict:
    fuel, known = observation.fuel, observation.known
    shortage_since = None
    if not fuel["available"]:
        # Une rupture déclarée sans date garde celle déjà connue.
        shortage_since = fuel.get("shortageSince") or (
            known.get("shortageSince") if observation.was_short else None
        )
    return {
        "_id": observation.key,
        "userId": observation.user_id,
        "stationId": observation.station_id,
        "fuel": fuel["code"],
        "available": fuel["available"],
        "shortageSince": shortage_since,
        "riskAlertedAt": seen_at if risk_alerted else (known or {}).get("riskAlertedAt"),
        "seenAt": seen_at,
    }

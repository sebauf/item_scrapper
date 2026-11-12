"""Le texte des alertes, prêt à envoyer tel quel (route Hermes en `deliver_only`).

Un gabarit Hermes ne sait pas boucler sur une liste : le texte est donc rendu
ici, et la route n'a qu'à afficher `{summary}`. Court, parce qu'il part
souvent par SMS.
"""
from datetime import datetime, timezone, tzinfo
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from src.fuel.alerts.detection import RESTOCK, RISK, SHORTAGE
from src.fuel.fuels import FUEL_LABELS, FUEL_RANK


def alert_summary(kind: str, events: list[dict]) -> str:
    return _SUMMARIES[kind](events)


def format_restock_summary(restocks: list[dict]) -> str:
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


_SUMMARIES = {
    RESTOCK: format_restock_summary,
    SHORTAGE: format_shortage_summary,
    RISK: format_risk_summary,
}


def _station_line(r: dict) -> str:
    who = r["brand"] or r["name"] or "Station"
    where = ", ".join(p for p in (r["address"], f"{r['postcode']} {r['city']}".strip()) if p)
    return f"• {FUEL_LABELS[r['fuel']]} — {who}, {where}"


def _fuel_labels(events: list[dict]) -> str:
    fuels = sorted({r["fuel"] for r in events}, key=FUEL_RANK.__getitem__)
    return ", ".join(FUEL_LABELS[code] for code in fuels)


def _local(value: datetime) -> str:
    """Date UTC naïve → « 26/10 à 14:00 », heure de Paris."""
    tz, suffix = _paris_tz()
    local = value.replace(tzinfo=timezone.utc).astimezone(tz)
    return f"{local:%d/%m à %H:%M}{suffix}"


def _paris_tz() -> tuple[tzinfo, str]:
    # L'image python:*-slim n'embarque pas forcément la base des fuseaux :
    # on retombe alors sur l'UTC, affiché comme tel, plutôt que d'échouer.
    try:
        return ZoneInfo("Europe/Paris"), ""
    except ZoneInfoNotFoundError:
        return timezone.utc, " UTC"

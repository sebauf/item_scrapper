"""Les destinataires : utilisateurs qui remplissent les trois conditions de
l'alerte (numéro, carburant, station favorite)."""
import re
from dataclasses import dataclass

from pymongo.database import Database

from src.fuel.favorites import favorite_stations_by_user
from src.fuel.fuels import FUEL_LABELS, FUEL_RANK

# Même forme que le backend (profile/domain/phone-number.ts), qui normalise à
# la saisie. Revérifiée ici : un numéro écrit à la main dans Mongo ne doit pas
# partir vers la passerelle SMS.
E164 = re.compile(r"^\+[1-9]\d{7,14}$")


def state_id(user_id: str, station_id: str, fuel: str) -> str:
    """`_id` de `fuel_watch_state` pour un triplet surveillé."""
    return f"{user_id}:{station_id}:{fuel}"


@dataclass(frozen=True)
class Subscriber:
    """Un utilisateur qui remplit les trois conditions de l'alerte."""
    user_id: str
    phone: str
    fuels: tuple[str, ...]
    station_ids: frozenset[str]

    def watched_state_ids(self) -> set[str]:
        return {
            state_id(self.user_id, station_id, fuel)
            for station_id in self.station_ids
            for fuel in self.fuels
        }


def load_subscribers(db: Database) -> list[Subscriber]:
    """Utilisateurs surveillés : numéro valide, carburant connu, station
    favorite. Triés par identifiant, pour un ordre d'envoi stable."""
    stations_by_user = favorite_stations_by_user(db)
    result = []
    for profile in db["user_profiles"].find({}, {"phone": 1, "alertFuels": 1}):
        user_id, phone = profile["_id"], profile.get("phone")
        fuels = _known_fuels(profile.get("alertFuels") or [])
        station_ids = stations_by_user.get(user_id)
        if _is_e164(phone) and fuels and station_ids:
            result.append(Subscriber(user_id, phone, fuels, frozenset(station_ids)))
    return sorted(result, key=lambda s: s.user_id)


def _known_fuels(codes: list[str]) -> tuple[str, ...]:
    """Carburants connus, sans doublon, dans l'ordre canonique."""
    return tuple(sorted({code for code in codes if code in FUEL_LABELS}, key=FUEL_RANK.__getitem__))


def _is_e164(phone: object) -> bool:
    return isinstance(phone, str) and E164.match(phone) is not None


def mask_phone(phone: str) -> str:
    """`+33612345678` → `+33•••••5678` : assez pour s'y retrouver dans les
    journaux d'Airflow, sans y recopier les numéros."""
    return phone[:3] + "•" * max(len(phone) - 7, 0) + phone[-4:]

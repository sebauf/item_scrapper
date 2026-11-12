"""Prévisions publiées : la chance de réapprovisionnement des carburants **en
rupture** des stations favorites, lisible par le backend.

Le pendant de `shortage_forecast.forecasts` : après chaque import (toutes les
30 minutes), écrit dans `fuel_restock_forecasts` :

    _id = "<stationId>:<carburant>"
    stationId, fuel, probability (0..1), computedAt, horizonHours (24)

`probability` = probabilité que la rupture en cours se termine dans les 24 h.

Périmètre : toutes les stations favorites d'au moins un utilisateur, et pour
chacune ses carburants **en rupture depuis moins de 7 jours**
(`dataset.MAX_SHORTAGE_AGE_SECONDS`). Un carburant disponible n'a pas de
prévision de réapprovisionnement (c'est l'autre modèle qui parle) ; une
rupture plus ancienne non plus : le modèle n'a pas appris sur elles, il
s'abstient plutôt que d'extrapoler. Une rupture sans date de début connue
non plus — son âge est la variable principale.

Mêmes règles de publication que pour la rupture : collection **remplacée** à
chaque publication, **vidée** sans modèle en service, **inchangée** si la
prévision échoue (le backend écarte de lui-même ce qui a plus de 2 h).
"""
from datetime import datetime, timedelta

from pymongo.database import Database

from src.fuel.favorites import favorite_station_fuels
from src.fuel.restock_forecast.dataset import MAX_SHORTAGE_AGE_SECONDS
from src.fuel.restock_forecast.features import compute_features
from src.fuel.shortage_forecast.forecasts import HORIZON_HOURS, write_forecasts

COLLECTION = "fuel_restock_forecasts"
FIELD = "probability"


def shortage_pairs(db: Database, now: datetime) -> list[tuple[str, str]]:
    """(station, carburant en rupture depuis moins de 7 jours) des stations
    favorites d'au moins un utilisateur."""
    oldest = now - timedelta(seconds=MAX_SHORTAGE_AGE_SECONDS)
    return sorted({
        (station_id, fuel["code"])
        for station_id, fuel in favorite_station_fuels(db)
        if _in_recent_shortage(fuel, oldest)
    })


def _in_recent_shortage(fuel: dict, oldest: datetime) -> bool:
    """En rupture, depuis une date connue postérieure à `oldest`."""
    since = fuel.get("shortageSince")
    return not fuel.get("available") and since is not None and since >= oldest


def predict_chances(db: Database, model, pairs: list[tuple[str, str]], now: datetime) -> dict[tuple[str, str], float]:
    """Probabilité de réapprovisionnement dans les 24 h de chaque couple.

    L'historique est lu par la **même** fonction que pour le modèle de
    rupture (`history_from_mongo`), après `episodes.record_live` : la rupture
    en cours y figure, ouverte, avec son début déclaré.
    """
    # Import tardif, pour la même raison que dans `publish_restock_forecasts`.
    from src.fuel.shortage_forecast.predict import predict_pairs

    return predict_pairs(db, model, pairs, now, compute_features)


def publish_restock_forecasts(db: Database, now: datetime) -> dict[tuple[str, str], float] | None:
    """Prévoit, publie, et renvoie la chance de réapprovisionnement à 24 h —
    ou None sans modèle en service ou si la prévision échoue.

    Ne lève jamais : les prix, les alertes et la prévision de rupture n'en
    dépendent pas.
    """
    try:
        # Importés ici, dans le try : un scikit-learn absent ou cassé ne doit
        # pas, lui non plus, faire échouer l'import des prix.
        from src.fuel.restock_forecast.model import RESTOCK
        from src.fuel.shortage_forecast.model import REPORT_THRESHOLD, load_model

        model = load_model(db, now, RESTOCK)
        if model is None:
            print("restock-chance: aucun modèle en service, prévisions retirées")
            db[COLLECTION].delete_many({})
            return None
        chances = predict_chances(db, model, shortage_pairs(db, now), now)
        write_forecasts(db, chances, now, COLLECTION, FIELD)
        likely = sum(1 for p in chances.values() if p >= REPORT_THRESHOLD)
        print(f"restock-chance: {len(chances)} rupture(s) de station favorite prévue(s), "
              f"{likely} à {REPORT_THRESHOLD * 100:.0f} % ou plus de finir dans les {HORIZON_HOURS} h")
        return chances
    except Exception as error:  # noqa: BLE001 — une prévision ratée ne prive ni des prix ni des alertes
        print(f"restock-chance: prévision impossible ({error!r}), prévisions publiées inchangées")
        return None

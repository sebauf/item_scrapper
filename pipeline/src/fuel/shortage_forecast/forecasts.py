"""Prévisions publiées : le risque de rupture des stations favorites, lisible
par le backend.

Le modèle est un pickle scikit-learn : seul le pipeline (Python) peut
l'exécuter. Le backend (TypeScript) ne lit donc que son **résultat**, écrit
ici après chaque import (toutes les 30 minutes) dans `fuel_shortage_forecasts` :

    _id = "<stationId>:<carburant>"
    stationId, fuel, risk (0..1), computedAt, horizonHours (24)

Périmètre : toutes les stations favorites d'au moins un utilisateur, et pour
chacune **tous** ses carburants disponibles — pas seulement ceux qu'un
utilisateur a cochés pour ses alertes. La page « Mes stations » montre tous les
carburants ; l'alerte, elle, ne lit que les couples qui la concernent dans le
même dictionnaire. Une seule prévision par import sert donc les deux.

Un carburant **en rupture** n'a pas de prévision : le modèle répond à « une
rupture commence-t-elle dans les 24 h ? », question sans objet quand elle a
déjà commencé (l'entraînement n'en contient d'ailleurs aucun exemple).

La collection est **remplacée** à chaque publication : un couple qui n'est plus
favori, ou plus disponible, disparaît. Sans modèle en service (absent, périmé,
incompatible), elle est vidée : une vieille prévision affichée comme actuelle
serait pire que pas de prévision. Si la prévision échoue, on n'y touche pas —
le backend écarte de lui-même les prévisions trop anciennes.
"""
from datetime import datetime

from pymongo import ReplaceOne
from pymongo.database import Database

from src.fuel.favorites import favorite_station_fuels

COLLECTION = "fuel_shortage_forecasts"
HORIZON_HOURS = 24


def forecast_id(station_id: str, fuel: str) -> str:
    return f"{station_id}:{fuel}"


def favorite_pairs(db: Database) -> list[tuple[str, str]]:
    """(station, carburant disponible) des stations favorites d'au moins un
    utilisateur."""
    return sorted({
        (station_id, fuel["code"])
        for station_id, fuel in favorite_station_fuels(db)
        if fuel.get("available")
    })


def write_forecasts(
    db: Database,
    risks: dict[tuple[str, str], float],
    computed_at: datetime,
    collection_name: str = COLLECTION,
    field: str = "risk",
) -> None:
    """Remplace les prévisions publiées par `risks`. (`collection_name` et
    `field` : la prévision de réapprovisionnement publie de la même façon,
    ailleurs et sous un autre nom.)"""
    collection = db[collection_name]
    if risks:
        collection.bulk_write([
            ReplaceOne(
                {"_id": forecast_id(station_id, fuel)},
                {
                    "stationId": station_id,
                    "fuel": fuel,
                    # Trois décimales : au-delà, c'est une précision que le
                    # modèle n'a pas.
                    field: round(risk, 3),
                    "computedAt": computed_at,
                    "horizonHours": HORIZON_HOURS,
                },
                upsert=True,
            )
            for (station_id, fuel), risk in risks.items()
        ])
    collection.delete_many({"computedAt": {"$ne": computed_at}})


def publish_forecasts(db: Database, now: datetime) -> dict[tuple[str, str], float] | None:
    """Prévoit, publie, et renvoie le risque à 24 h des stations favorites —
    ou None sans modèle en service ou si la prévision échoue.

    Ne lève jamais : une prévision ratée ne doit priver personne des prix, ni
    des alertes de rupture et de réapprovisionnement, qui n'en dépendent pas.
    """
    try:
        # Importés ici, dans le try : un scikit-learn absent ou cassé ne doit
        # pas, lui non plus, faire échouer l'import des prix.
        from src.fuel.shortage_forecast.model import REPORT_THRESHOLD, load_model
        from src.fuel.shortage_forecast.predict import predict_risks

        model = load_model(db, now)
        if model is None:
            print("shortage-risk: aucun modèle en service, prévisions retirées")
            db[COLLECTION].delete_many({})
            return None
        risks = predict_risks(db, model, favorite_pairs(db), now)
        write_forecasts(db, risks, now)
        high = sum(1 for p in risks.values() if p >= REPORT_THRESHOLD)
        print(f"shortage-risk: {len(risks)} couple(s) station favorite × carburant prévu(s), "
              f"{high} à {REPORT_THRESHOLD * 100:.0f} % ou plus")
        return risks
    except Exception as error:  # noqa: BLE001 — une prévision ratée ne prive ni des prix ni des alertes
        print(f"shortage-risk: prévision impossible ({error!r}), prévisions publiées inchangées")
        return None

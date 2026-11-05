"""Risque de rupture dans les 24 h, en direct, pour quelques couples.

Appelé par l'alerte après chaque import (toutes les 30 minutes), seulement
pour les stations favorites des utilisateurs surveillés. Les variables sont
calculées par la **même** fonction que pour l'entraînement
(`features.compute_features`), sur un `History` lu dans MongoDB :

- `fuel_shortages` → les ruptures (cf. episodes.py) ;
- `fuel_stations` → les carburants vendus, le département (code postal), le
  type de route et la date du dernier changement de prix (`updatedAt`).

Dans l'archive, un couple est « vendu » entre son premier et son dernier
changement de prix ; ici, il l'est s'il figure dans le dernier import. C'est
la même définition vue à l'instant présent.
"""
from datetime import datetime, timedelta

import pandas as pd
from pymongo.database import Database

from src.fuel.shortage_forecast import episodes
from src.fuel.shortage_forecast.archive import department
from src.fuel.shortage_forecast.features import History, compute_features
from src.fuel.shortage_forecast.model import ShortageModel

_LOOKBACK_DAYS = 181
_EPOCH = pd.Timestamp("1970-01-01")


def history_from_mongo(db: Database, now: datetime) -> History:
    sold_rows, price_rows = [], []
    projection = {"fuels.code": 1, "fuels.updatedAt": 1, "postcode": 1, "roadType": 1}
    for station in db["fuel_stations"].find({}, projection):
        dept = department(station.get("postcode"))
        for fuel in station.get("fuels", []):
            sold_rows.append((station["_id"], fuel["code"], dept, station.get("roadType")))
            if fuel.get("updatedAt") is not None:
                price_rows.append((station["_id"], fuel["code"], fuel["updatedAt"]))
    sold = pd.DataFrame(sold_rows, columns=["station", "fuel", "dept", "pop"])
    sold["first_at"], sold["last_at"] = _EPOCH, pd.Timestamp(now)

    since = now - timedelta(days=_LOOKBACK_DAYS)
    shortage_rows = [
        (doc["stationId"], doc["fuel"], doc["start"], doc.get("end"))
        for doc in db[episodes.COLLECTION].find(
            {"$or": [{"start": {"$gte": since}}, {"end": None}]},
            {"stationId": 1, "fuel": 1, "start": 1, "end": 1},
        )
    ]
    shortages = pd.DataFrame(shortage_rows, columns=["station", "fuel", "start", "end"])
    shortages["start"] = pd.to_datetime(shortages["start"])
    shortages["end"] = pd.to_datetime(shortages["end"])
    prices = pd.DataFrame(price_rows, columns=["station", "fuel", "at"])
    prices["at"] = pd.to_datetime(prices["at"])
    return History(shortages=shortages, sold=sold, prices=prices, as_of=pd.Timestamp(now))


def predict_risks(
    db: Database, model: ShortageModel, pairs: list[tuple[str, str]], now: datetime
) -> dict[tuple[str, str], float]:
    """Probabilité de rupture dans les 24 h de chaque (station, carburant)."""
    if not pairs:
        return {}
    history = history_from_mongo(db, now)
    queries = pd.DataFrame(pairs, columns=["station", "fuel"]).assign(t=pd.Timestamp(now))
    risks = model.predict(compute_features(history, queries))
    return {pair: float(p) for pair, p in zip(pairs, risks)}

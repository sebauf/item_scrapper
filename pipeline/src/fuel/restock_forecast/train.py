"""Entraînement du modèle de réapprovisionnement.

Appelé par la tâche quotidienne `shortage_forecast.train`, juste après le
modèle de rupture, sur le **même** historique : l'archive (~60 Mo, ~3 min de
lecture) n'est téléchargée et lue qu'une fois pour les deux.

Pour un essai à la main (télécharge l'archive, sans resynchroniser
`fuel_shortages`) :

    python -m src.fuel.restock_forecast.train
"""
from datetime import datetime

from pymongo.database import Database

from src.clock import naive_utc_now
from src.database import open_database
from src.fuel.restock_forecast.dataset import build_dataset
from src.fuel.restock_forecast.model import RESTOCK
from src.fuel.shortage_forecast.archive import fetch_archives
from src.fuel.shortage_forecast.dataset import history_from_archive, training_start
from src.fuel.shortage_forecast.features import History
from src.fuel.shortage_forecast.model import (
    format_metrics,
    record_rejection,
    save_model,
    train_and_validate,
)


def run(db: Database, history: History, data_until: datetime, now: datetime) -> bool:
    """Renvoie True si un nouveau modèle a été mis en service."""
    start = training_start(history)
    dataset = build_dataset(history, start, history.as_of)
    print(f"restock dataset: {len(dataset.y)} instantanés en rupture dont {int(dataset.y.sum())} "
          f"réapprovisionnés dans les 24 h, du {start:%d/%m/%Y} au {history.as_of:%d/%m/%Y}")

    result = train_and_validate(dataset, RESTOCK)
    if "test" in result.metrics:
        print(f"restock test  modèle : {format_metrics(result.metrics['test'])}")
        print(f"restock test  naïf   : {format_metrics(result.metrics['baseline'])}")
    if not result.accepted:
        print(f"modèle de réapprovisionnement refusé : {result.reason} — le modèle en service est conservé")
        record_rejection(db, result, now, RESTOCK)
        return False
    save_model(db, result, data_until=data_until, trained_at=now, spec=RESTOCK)
    print("modèle de réapprovisionnement mis en service")
    return True


if __name__ == "__main__":
    now = naive_utc_now()
    archive = fetch_archives([now.year - 1, now.year])
    with open_database() as db:
        run(db, history_from_archive(archive), archive.generated_at, now)

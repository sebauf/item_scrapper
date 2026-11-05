"""Tâche quotidienne : archive → `fuel_shortages` → modèle.

    python -m src.fuel.shortage_forecast.train

1. télécharge les archives de l'année précédente et de l'année en cours
   (~60 Mo), régénérées chaque nuit par le ministère ;
2. resynchronise `fuel_shortages` sur l'archive (cf. episodes.py) ;
3. tire les instantanés des `TRAINING_DAYS` derniers jours, entraîne, valide
   sur les quatre dernières semaines ;
4. met le modèle en service s'il bat la méthode naïve, sinon garde l'ancien.

Compter environ 5 minutes et 2,5 Go de mémoire au pic (année de crise : près
de 10 millions de changements de prix lus).
"""
from datetime import datetime, timezone

import pandas as pd
from pymongo.database import Database

from src.fuel.shortage_forecast import episodes
from src.fuel.shortage_forecast.archive import Archive, fetch_archives
from src.fuel.shortage_forecast.dataset import DEFAULT_NEGATIVE_RATE, build_dataset, history_from_archive
from src.fuel.shortage_forecast.model import record_rejection, save_model, train_and_validate

# 180 jours de recul pour les variables + 400 jours d'instantanés : il faut
# l'année précédente entière, plus l'année en cours.
TRAINING_DAYS = 400
LOOKBACK_DAYS = 180


def _fmt(metrics: dict) -> str:
    return (f"AUC {metrics['auc']:.3f}, précision moyenne {metrics['averagePrecision']:.3f}, "
            f"Brier {metrics['brier']:.4f}, précision@{metrics['threshold']:.0%} "
            f"{(metrics['precision'] or 0):.0%}, rappel {(metrics['recall'] or 0):.0%}")


def run(db: Database, archive: Archive, now: datetime) -> bool:
    """Renvoie True si un nouveau modèle a été mis en service."""
    episodes.ensure_indexes(db)
    synced = episodes.sync_from_archive(db, archive, now)
    print(f"fuel_shortages: {synced} ruptures synchronisées sur l'archive "
          f"(jusqu'au {archive.generated_at:%d/%m %H:%M} UTC)")

    history = history_from_archive(archive)
    covered_from = history.sold["first_at"].min()
    start = max(covered_from + pd.Timedelta(days=LOOKBACK_DAYS),
                history.as_of - pd.Timedelta(days=TRAINING_DAYS))
    dataset = build_dataset(history, start, history.as_of, negative_rate=DEFAULT_NEGATIVE_RATE)
    print(f"dataset: {len(dataset.y)} instantanés dont {int(dataset.y.sum())} suivis d'une rupture, "
          f"du {start:%d/%m/%Y} au {history.as_of:%d/%m/%Y}")

    result = train_and_validate(dataset)
    if "test" in result.metrics:
        print(f"test  modèle : {_fmt(result.metrics['test'])}")
        print(f"test  naïf   : {_fmt(result.metrics['baseline'])}")
    if not result.accepted:
        print(f"modèle refusé : {result.reason} — le modèle en service est conservé")
        record_rejection(db, result, now)
        return False
    save_model(db, result, data_until=archive.generated_at, trained_at=now)
    print("modèle mis en service")
    return True


if __name__ == "__main__":
    from pymongo import MongoClient

    from src.config import DB_NAME, MONGODB_URI

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    archive = fetch_archives([now.year - 1, now.year])
    run(MongoClient(MONGODB_URI)[DB_NAME], archive, now)

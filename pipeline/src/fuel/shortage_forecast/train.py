"""Tâche quotidienne : archive → `fuel_shortages` → modèle.

    python -m src.fuel.shortage_forecast.train

1. télécharge les archives de l'année précédente et de l'année en cours
   (~60 Mo), régénérées chaque nuit par le ministère ;
2. resynchronise `fuel_shortages` sur l'archive (cf. episodes.py) ;
3. tire les instantanés des `dataset.TRAINING_DAYS` derniers jours, entraîne, valide
   sur les quatre dernières semaines ;
4. met le modèle en service s'il bat la méthode naïve, sinon garde l'ancien ;
5. entraîne de même le modèle de **réapprovisionnement**
   (`src.fuel.restock_forecast.train`) sur le même historique — l'archive
   n'est lue qu'une fois. Les deux modèles sont jugés et mis en service
   indépendamment ; si le second lève, le premier est déjà enregistré et la
   tâche échoue (visible dans Airflow, relancée 30 min plus tard).

Compter environ 5 minutes et 2,5 Go de mémoire au pic (année de crise : près
de 10 millions de changements de prix lus).
"""
from datetime import datetime

from pymongo.database import Database

from src.clock import naive_utc_now
from src.database import open_database
from src.fuel.restock_forecast import train as restock_train
from src.fuel.shortage_forecast import episodes
from src.fuel.shortage_forecast.archive import Archive, fetch_archives
from src.fuel.shortage_forecast.dataset import (
    DEFAULT_NEGATIVE_RATE,
    build_dataset,
    history_from_archive,
    training_start,
)
from src.fuel.shortage_forecast.model import (
    format_metrics,
    record_rejection,
    save_model,
    train_and_validate,
)


def run(db: Database, archive: Archive, now: datetime) -> bool:
    """Renvoie True si un nouveau modèle **de rupture** a été mis en service
    (celui de réapprovisionnement est entraîné ensuite, cf. étape 5)."""
    episodes.ensure_indexes(db)
    synced = episodes.sync_from_archive(db, archive, now)
    print(f"fuel_shortages: {synced} ruptures synchronisées sur l'archive "
          f"(jusqu'au {archive.generated_at:%d/%m %H:%M} UTC)")

    history = history_from_archive(archive)
    start = training_start(history)
    dataset = build_dataset(history, start, history.as_of, negative_rate=DEFAULT_NEGATIVE_RATE)
    print(f"dataset: {len(dataset.y)} instantanés dont {int(dataset.y.sum())} suivis d'une rupture, "
          f"du {start:%d/%m/%Y} au {history.as_of:%d/%m/%Y}")

    result = train_and_validate(dataset)
    del dataset  # ~1 Go au pic : libéré avant le second modèle
    if "test" in result.metrics:
        print(f"test  modèle : {format_metrics(result.metrics['test'])}")
        print(f"test  naïf   : {format_metrics(result.metrics['baseline'])}")
    if result.accepted:
        save_model(db, result, data_until=archive.generated_at, trained_at=now)
        print("modèle mis en service")
    else:
        print(f"modèle refusé : {result.reason} — le modèle en service est conservé")
        record_rejection(db, result, now)

    restock_train.run(db, history, archive.generated_at, now)
    return result.accepted


if __name__ == "__main__":
    now = naive_utc_now()
    archive = fetch_archives([now.year - 1, now.year])
    with open_database() as db:
        run(db, archive, now)

"""Daily pipeline: scrape Amazon -> purge the products the scrapper can no
longer read -> refine into price_history -> score every product's current price
against its own price history. Alongside, a housekeeping task deletes Airflow's
own task logs past LOG_RETENTION_DAYS.

Each step runs in its own ephemeral container, reusing the images already
built by CI; see pipeline_tasks.py for the docker / kubernetes backends.
"""
import os
import random
import time
from datetime import datetime, timedelta
from pathlib import Path

from airflow import DAG
from airflow.operators.python import PythonOperator

from pipeline_tasks import REGISTRY, build_task

LOG_RETENTION_DAYS = int(os.environ.get("AIRFLOW_LOG_RETENTION_DAYS", "30"))

default_args = {
    "owner": "airflow",
    "retries": 2,
    "retry_delay": timedelta(minutes=5),
    "execution_timeout": timedelta(hours=2),
}


def _random_night_delay() -> None:
    """Sleep a random amount so the scrape doesn't hit Amazon at a predictable time.

    Triggered at 01:00; actual scrape starts between ~01:05 and ~04:00.
    """
    delay_seconds = random.randint(5 * 60, 3 * 60 * 60)
    print(f"Jitter delay: {delay_seconds // 60}m {delay_seconds % 60}s")
    time.sleep(delay_seconds)


def _cleanup_old_logs() -> None:
    """Delete Airflow log files older than LOG_RETENTION_DAYS, then the empty
    directories left behind.

    Airflow 2 never prunes its task logs, and in k8s they sit on a fixed-size
    PVC (k8s/base/airflow-scheduler.yaml). This runs in-process: with
    LocalExecutor the task executes in the scheduler Pod, the one that mounts
    that volume.
    """
    from airflow.configuration import conf

    base = Path(conf.get("logging", "base_log_folder"))
    cutoff = time.time() - LOG_RETENTION_DAYS * 86400
    deleted = 0
    # Profondeur d'abord : un dossier n'est examiné qu'une fois ses fichiers
    # supprimés, ce qui permet de le retirer s'il est devenu vide.
    for root, dirs, files in os.walk(base, topdown=False):
        for name in files:
            path = Path(root) / name
            # Le lien `scheduler/latest` est réécrit par le scheduler.
            if path.is_symlink():
                continue
            if path.stat().st_mtime < cutoff:
                path.unlink()
                deleted += 1
        for name in dirs:
            path = Path(root) / name
            if not path.is_symlink() and not any(path.iterdir()):
                path.rmdir()
    print(f"Deleted {deleted} log file(s) older than {LOG_RETENTION_DAYS} days from {base}")


with DAG(
    dag_id="price_pipeline_dag",
    description="Scrape -> purge -> refine -> score the deal-tracking pipeline",
    default_args=default_args,
    schedule="0 1 * * *",
    start_date=datetime(2026, 1, 1),
    catchup=False,
    tags=["scrapper", "pipeline"],
) as dag:
    jitter = PythonOperator(
        task_id="random_delay",
        python_callable=_random_night_delay,
        execution_timeout=None,
    )

    # Le scrape relit tout le catalogue (MAX_REQUESTS_PER_CRAWL=1000) à 10
    # requêtes/minute, soit ~100 min : la marge des 2 h par défaut est trop
    # mince. Un run tué en route ne perd pas que des prix — les écrans
    # masquent les produits non rafraîchis par le dernier passage, donc une
    # moitié du catalogue disparaîtrait de l'affichage jusqu'au run suivant.
    scrape = build_task("scrape", image=f"{REGISTRY}-scrapper:main")
    scrape.execution_timeout = timedelta(hours=3)

    # Avant le refine : celui-ci reconstruit price_history depuis items_raw,
    # donc purger après lui ferait ressusciter les documents supprimés.
    purge = build_task(
        "purge",
        image=f"{REGISTRY}-pipeline:main",
        command=["python", "-m", "src.maintenance.purge_dead_products"],
    )

    refine = build_task(
        "refine", image=f"{REGISTRY}-pipeline:main", command=["python", "-m", "src.refine.build_price_history"]
    )

    score = build_task(
        "score", image=f"{REGISTRY}-pipeline:main", command=["python", "-m", "src.scoring.score"]
    )

    # Hors de la chaîne : une panne du scrape ne doit pas empêcher le ménage,
    # sinon c'est le jour où les logs grossissent le plus qu'ils ne sont plus
    # nettoyés.
    _cleanup = PythonOperator(task_id="cleanup_logs", python_callable=_cleanup_old_logs)

    jitter >> scrape >> purge >> refine >> score

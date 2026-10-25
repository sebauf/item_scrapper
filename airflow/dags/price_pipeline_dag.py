"""Daily pipeline: scrape Amazon -> purge the products the scrapper can no
longer read -> refine into price_history -> score every product's current price
against its own price history. Alongside, a housekeeping task deletes Airflow's
own task logs past LOG_RETENTION_DAYS.

Each step runs in its own ephemeral container, reusing the images already
built by CI (.github/workflows/scrapper.yml and pipeline.yml).

Two execution backends are supported, picked at import time via the
PIPELINE_EXECUTOR env var:
  - "docker" (default): DockerOperator, launches sibling containers on the
    host's Docker engine. Used by infra/docker-compose.yml for local dev.
  - "kubernetes": KubernetesPodOperator, launches Pods in the cluster. Used
    by the Airflow deployment in k8s/ (see k8s/base/airflow-rbac.yaml for
    the ServiceAccount permissions this needs).
"""
import os
import random
import time
from datetime import datetime, timedelta
from pathlib import Path

from airflow import DAG
from airflow.operators.python import PythonOperator

EXECUTOR = os.environ.get("PIPELINE_EXECUTOR", "docker").lower()
REGISTRY = os.environ.get("IMAGE_REGISTRY", "ghcr.io/YOUR_GITHUB_USERNAME/item_scrapper")
MONGODB_URI = os.environ.get("MONGODB_URI", "")
NAMESPACE = os.environ.get("AIRFLOW_K8S_NAMESPACE", "price-tracker")
SECRET_NAME = os.environ.get("PIPELINE_SECRET_NAME", "price-tracker-secrets")
LOG_RETENTION_DAYS = int(os.environ.get("AIRFLOW_LOG_RETENTION_DAYS", "30"))

default_args = {
    "owner": "airflow",
    "retries": 2,
    "retry_delay": timedelta(minutes=5),
    "execution_timeout": timedelta(hours=2),
}


def _build_docker_task(task_id: str, image: str, command: list[str] | None):
    from airflow.providers.docker.operators.docker import DockerOperator

    return DockerOperator(
        task_id=task_id,
        image=image,
        command=command,
        docker_url="unix://var/run/docker.sock",
        network_mode="item_scrapper_net",
        auto_remove="success",
        mount_tmp_dir=False,
        environment={"MONGODB_URI": MONGODB_URI},
    )


def _build_k8s_task(task_id: str, image: str, command: list[str] | None):
    from kubernetes.client import models as k8s
    from airflow.providers.cncf.kubernetes.operators.pod import KubernetesPodOperator

    return KubernetesPodOperator(
        task_id=task_id,
        name=f"price-pipeline-{task_id}",
        namespace=NAMESPACE,
        image=image,
        # Les images portent le tag mobile `main`, réécrit à chaque push : sans
        # cette ligne, Kubernetes retombe sur `IfNotPresent` et réutilise
        # indéfiniment la couche déjà présente sur le nœud. Une tâche pointant
        # du code tout juste publié s'exécuterait alors dans l'image de la
        # veille — d'où l'échec d'une étape nouvellement ajoutée au DAG, qui
        # n'existe pas encore dans l'image en cache. C'est la même politique
        # que celle des Deployments de k8s/base.
        image_pull_policy="Always",
        cmds=command if command else None,
        env_from=[k8s.V1EnvFromSource(secret_ref=k8s.V1SecretEnvSource(name=SECRET_NAME))],
        image_pull_secrets=[k8s.V1LocalObjectReference(name="ghcr-pull-secret")],
        is_delete_operator_pod=True,
        get_logs=True,
        in_cluster=True,
    )


def _build_task(task_id: str, image: str, command: list[str] | None = None):
    if EXECUTOR == "kubernetes":
        return _build_k8s_task(task_id, image, command)
    return _build_docker_task(task_id, image, command)


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
    scrape = _build_task("scrape", image=f"{REGISTRY}-scrapper:main")
    scrape.execution_timeout = timedelta(hours=3)

    # Avant le refine : celui-ci reconstruit price_history depuis items_raw,
    # donc purger après lui ferait ressusciter les documents supprimés.
    purge = _build_task(
        "purge",
        image=f"{REGISTRY}-pipeline:main",
        command=["python", "-m", "src.maintenance.purge_dead_products"],
    )

    refine = _build_task(
        "refine", image=f"{REGISTRY}-pipeline:main", command=["python", "-m", "src.refine.build_price_history"]
    )

    score = _build_task(
        "score", image=f"{REGISTRY}-pipeline:main", command=["python", "-m", "src.scoring.score"]
    )

    # Hors de la chaîne : une panne du scrape ne doit pas empêcher le ménage,
    # sinon c'est le jour où les logs grossissent le plus qu'ils ne sont plus
    # nettoyés.
    _cleanup = PythonOperator(task_id="cleanup_logs", python_callable=_cleanup_old_logs)

    jitter >> scrape >> purge >> refine >> score

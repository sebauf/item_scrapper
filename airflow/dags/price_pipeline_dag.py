"""Daily pipeline: scrape Amazon -> refine into price_history -> score every
product's current price against its own price history.

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

from airflow import DAG
from airflow.operators.python import PythonOperator

EXECUTOR = os.environ.get("PIPELINE_EXECUTOR", "docker").lower()
REGISTRY = os.environ.get("IMAGE_REGISTRY", "ghcr.io/YOUR_GITHUB_USERNAME/item_scrapper")
MONGODB_URI = os.environ.get("MONGODB_URI", "")
NAMESPACE = os.environ.get("AIRFLOW_K8S_NAMESPACE", "price-tracker")
SECRET_NAME = os.environ.get("PIPELINE_SECRET_NAME", "price-tracker-secrets")

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


with DAG(
    dag_id="price_pipeline_dag",
    description="Scrape -> refine -> score the deal-tracking pipeline",
    default_args=default_args,
    schedule="0 1 * * *",
    start_date=datetime(2026, 1, 1),
    catchup=False,
    tags=["scrapper", "pipeline"],
) as dag:
    jitter = PythonOperator(
        task_id="random_delay",
        python_callable=_random_night_delay,
    )

    scrape = _build_task("scrape", image=f"{REGISTRY}-scrapper:main")

    refine = _build_task(
        "refine", image=f"{REGISTRY}-pipeline:main", command=["python", "-m", "src.refine.build_price_history"]
    )

    score = _build_task(
        "score", image=f"{REGISTRY}-pipeline:main", command=["python", "-m", "src.scoring.score"]
    )

    jitter >> scrape >> refine >> score

"""Daily pipeline: scrape Amazon -> refine into price_history -> train the
deal-scoring model -> score every product's current price.

Each step runs in its own ephemeral container, reusing the images already
built by CI (.github/workflows/scrapper.yml and pipeline.yml). `train` and
`score` share a volume so that a failed `score` run can be retried on its
own, without re-training.

Two execution backends are supported, picked at import time via the
PIPELINE_EXECUTOR env var:
  - "docker" (default): DockerOperator, launches sibling containers on the
    host's Docker engine. Used by infra/docker-compose.yml for local dev.
  - "kubernetes": KubernetesPodOperator, launches Pods in the cluster. Used
    by the Airflow deployment in k8s/ (see k8s/base/airflow-rbac.yaml for
    the ServiceAccount permissions this needs).
"""
import os
from datetime import datetime, timedelta

from airflow import DAG

EXECUTOR = os.environ.get("PIPELINE_EXECUTOR", "docker").lower()
REGISTRY = os.environ.get("IMAGE_REGISTRY", "ghcr.io/YOUR_GITHUB_USERNAME/item_scrapper")
MONGODB_URI = os.environ.get("MONGODB_URI", "")
NAMESPACE = os.environ.get("AIRFLOW_K8S_NAMESPACE", "price-tracker")
SECRET_NAME = os.environ.get("PIPELINE_SECRET_NAME", "price-tracker-secrets")
MODEL_VOLUME_NAME = os.environ.get("PIPELINE_MODEL_VOLUME", "pipeline_models")

default_args = {
    "owner": "airflow",
    "retries": 2,
    "retry_delay": timedelta(minutes=5),
    "execution_timeout": timedelta(hours=2),
}


def _build_docker_task(task_id: str, image: str, command: list[str] | None, with_model_volume: bool):
    from docker.types import Mount
    from airflow.providers.docker.operators.docker import DockerOperator

    mounts = [Mount(source=MODEL_VOLUME_NAME, target="/app/models", type="volume")] if with_model_volume else []
    return DockerOperator(
        task_id=task_id,
        image=image,
        command=command,
        docker_url="unix://var/run/docker.sock",
        network_mode="item_scrapper_net",
        auto_remove="success",
        mount_tmp_dir=False,
        mounts=mounts,
        environment={"MONGODB_URI": MONGODB_URI},
    )


def _build_k8s_task(task_id: str, image: str, command: list[str] | None, with_model_volume: bool):
    from kubernetes.client import models as k8s
    from airflow.providers.cncf.kubernetes.operators.pod import KubernetesPodOperator

    volumes, volume_mounts = [], []
    if with_model_volume:
        volumes = [k8s.V1Volume(name="models", persistent_volume_claim=k8s.V1PersistentVolumeClaimVolumeSource(
            claim_name=MODEL_VOLUME_NAME,
        ))]
        volume_mounts = [k8s.V1VolumeMount(name="models", mount_path="/app/models")]

    return KubernetesPodOperator(
        task_id=task_id,
        name=f"price-pipeline-{task_id}",
        namespace=NAMESPACE,
        image=image,
        cmds=command if command else None,
        env_from=[k8s.V1EnvFromSource(secret_ref=k8s.V1SecretEnvSource(name=SECRET_NAME))],
        image_pull_secrets=[k8s.V1LocalObjectReference(name="ghcr-pull-secret")],
        volumes=volumes,
        volume_mounts=volume_mounts,
        is_delete_operator_pod=True,
        get_logs=True,
        in_cluster=True,
    )


def _build_task(task_id: str, image: str, command: list[str] | None = None, with_model_volume: bool = False):
    if EXECUTOR == "kubernetes":
        return _build_k8s_task(task_id, image, command, with_model_volume)
    return _build_docker_task(task_id, image, command, with_model_volume)


with DAG(
    dag_id="price_pipeline_dag",
    description="Scrape -> refine -> train -> score the deal-tracking pipeline",
    default_args=default_args,
    schedule="0 6 * * *",
    start_date=datetime(2026, 1, 1),
    catchup=False,
    tags=["scrapper", "pipeline", "ml"],
) as dag:
    scrape = _build_task("scrape", image=f"{REGISTRY}-scrapper:main")

    refine = _build_task(
        "refine", image=f"{REGISTRY}-pipeline:main", command=["python", "-m", "src.refine.build_price_history"]
    )

    train = _build_task(
        "train",
        image=f"{REGISTRY}-pipeline:main",
        command=["python", "-m", "src.scoring.train"],
        with_model_volume=True,
    )

    score = _build_task(
        "score",
        image=f"{REGISTRY}-pipeline:main",
        command=["python", "-m", "src.scoring.score"],
        with_model_volume=True,
    )

    scrape >> refine >> train >> score

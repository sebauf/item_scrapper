"""Construction des tâches conteneurisées, partagée par les DAGs.

Chaque étape tourne dans un conteneur éphémère, en réutilisant les images déjà
construites par la CI (.github/workflows/scrapper.yml et pipeline.yml).

Two execution backends are supported, picked at import time via the
PIPELINE_EXECUTOR env var:
  - "docker" (default): DockerOperator, launches sibling containers on the
    host's Docker engine. Used by infra/docker-compose.yml for local dev.
  - "kubernetes": KubernetesPodOperator, launches Pods in the cluster. Used
    by the Airflow deployment in k8s/ (see k8s/base/airflow-rbac.yaml for
    the ServiceAccount permissions this needs).

Ce module n'est pas un DAG : il est listé dans `.airflowignore` pour que le
scheduler ne le parse pas en boucle. Il reste importable, le dossier des DAGs
étant sur le `sys.path` d'Airflow.
"""
import os

EXECUTOR = os.environ.get("PIPELINE_EXECUTOR", "docker").lower()
REGISTRY = os.environ.get("IMAGE_REGISTRY", "ghcr.io/YOUR_GITHUB_USERNAME/item_scrapper")
MONGODB_URI = os.environ.get("MONGODB_URI", "")
NAMESPACE = os.environ.get("AIRFLOW_K8S_NAMESPACE", "price-tracker")
SECRET_NAME = os.environ.get("PIPELINE_SECRET_NAME", "price-tracker-secrets")


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


def _build_k8s_task(task_id: str, image: str, command: list[str] | None, pod_prefix: str):
    from kubernetes.client import models as k8s
    from airflow.providers.cncf.kubernetes.operators.pod import KubernetesPodOperator

    return KubernetesPodOperator(
        task_id=task_id,
        name=f"{pod_prefix}-{task_id}",
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


def build_task(
    task_id: str,
    image: str,
    command: list[str] | None = None,
    pod_prefix: str = "price-pipeline",
):
    if EXECUTOR == "kubernetes":
        return _build_k8s_task(task_id, image, command, pod_prefix)
    return _build_docker_task(task_id, image, command)

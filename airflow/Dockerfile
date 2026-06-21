FROM apache/airflow:2.10.4-python3.12
RUN pip install --no-cache-dir \
    "apache-airflow-providers-docker>=3.9.0" \
    "apache-airflow-providers-cncf-kubernetes>=8.4.0"

# Baked in so the image works standalone in k8s (no DAGs volume there).
# docker-compose still bind-mounts ../airflow/dags over this for live editing.
COPY dags/ /opt/airflow/dags/

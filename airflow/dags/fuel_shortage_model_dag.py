"""Modèle de rupture de carburant : réentraîné chaque matin sur l'archive
officielle (cf. pipeline/src/fuel/shortage_forecast/train.py).

Une seule tâche, `train_shortage_model`, dans l'image du pipeline :

1. télécharge l'archive annuelle de l'année précédente et de l'année en cours
   (~60 Mo, régénérée par le ministère vers 23 h 40, heure de Paris) ;
2. resynchronise `fuel_shortages` sur cette archive, qui fait foi ;
3. entraîne, valide sur les quatre dernières semaines, et ne met le modèle en
   service que s'il bat la méthode naïve (sinon l'ancien reste en place) ;
4. fait de même, sur le même historique, pour le modèle de
   **réapprovisionnement** (cf. pipeline/src/fuel/restock_forecast) : ~1 min
   de plus, l'archive n'étant lue qu'une fois.

Le modèle sert ensuite à chaque import du DAG `fuel_prices_dag`, toutes les
30 minutes : c'est là que partent les alertes de risque, et que sont publiées
les prévisions de rupture et de réapprovisionnement de « Mes stations ».

Pourquoi chaque jour : le taux de rupture a été multiplié par 17 en quelques
mois en 2026. Un modèle de la semaine dernière se tromperait d'échelle ; au-delà
de 7 jours sans réentraînement, l'alerte de risque se coupe d'elle-même
(`model.MAX_MODEL_AGE_DAYS`) plutôt que d'annoncer faux.

Horaire : 5 h 17 heure de Paris, après la régénération nocturne de l'archive
et à une minute choisie pour ne pas tomber à l'heure pile. Indépendant des
deux autres DAGs : un échec ici ne prive personne des alertes de rupture et
de réapprovisionnement, qui ne dépendent pas du modèle.
"""
from datetime import timedelta

import pendulum
from airflow import DAG

from pipeline_tasks import REGISTRY, build_task

default_args = {
    "owner": "airflow",
    "retries": 1,
    # L'archive peut être en cours de régénération : on retente plus tard.
    "retry_delay": timedelta(minutes=30),
    # ~5 min en temps normal (lecture de ~10 millions de changements de prix,
    # entraînement ~20 s). Au-delà, quelque chose ne va pas.
    "execution_timeout": timedelta(minutes=45),
}

with DAG(
    dag_id="fuel_shortage_model_dag",
    description="Archive officielle -> fuel_shortages -> modèles de rupture et de réapprovisionnement à 24 h",
    default_args=default_args,
    schedule="17 5 * * *",
    start_date=pendulum.datetime(2026, 1, 1, tz="Europe/Paris"),
    catchup=False,
    max_active_runs=1,
    tags=["carburants", "pipeline", "ml"],
) as dag:
    build_task(
        "train_shortage_model",
        image=f"{REGISTRY}-pipeline:main",
        command=["python", "-m", "src.fuel.shortage_forecast.train"],
        pod_prefix="fuel-shortage",
    )

"""Prix des carburants : importe trois fois par jour le flux officiel des
stations-service dans `fuel_stations` (cf. pipeline/src/fuel/import_stations.py).

Séparé de price_pipeline_dag, et volontairement :

- **pas de délai aléatoire.** Celui du scrape Amazon sert à ne pas se présenter
  à heure fixe devant un anti-bot ; ici on lit une API publique faite pour être
  interrogée.
- **pas de dépendance au scrape.** Une panne côté Amazon ne doit pas figer les
  prix des carburants, et inversement.

Horaires en heure de Paris (le `start_date` porte le fuseau, la cron s'y
applique, heure d'été comprise) : 7 h pour les prix déclarés à l'ouverture,
12 h et 18 h avant les trajets du midi et du soir. Le flux se rafraîchit toutes
les 10 à 15 minutes ; importer plus souvent ne coûterait qu'une requête, il
suffit de modifier la cron.
"""
from datetime import timedelta

import pendulum
from airflow import DAG

from pipeline_tasks import REGISTRY, build_task

default_args = {
    "owner": "airflow",
    "retries": 2,
    "retry_delay": timedelta(minutes=10),
    # Un seul appel HTTP et ~10 000 upserts : quelques dizaines de secondes en
    # temps normal. Au-delà, l'API est en difficulté et le run suivant fera mieux.
    "execution_timeout": timedelta(minutes=15),
}

with DAG(
    dag_id="fuel_prices_dag",
    description="Import du flux officiel des prix des carburants -> fuel_stations",
    default_args=default_args,
    schedule="0 7,12,18 * * *",
    start_date=pendulum.datetime(2026, 1, 1, tz="Europe/Paris"),
    catchup=False,
    # Deux imports concurrents se supprimeraient mutuellement leurs stations
    # (chacun efface ce qui ne porte pas son propre `importedAt`).
    max_active_runs=1,
    tags=["carburants", "pipeline"],
) as dag:
    build_task(
        "import_fuel_stations",
        image=f"{REGISTRY}-pipeline:main",
        command=["python", "-m", "src.fuel.import_stations"],
        pod_prefix="fuel-prices",
    )

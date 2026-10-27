"""Prix des carburants : importe toutes les 30 minutes le flux officiel des
stations-service dans `fuel_stations` (cf. pipeline/src/fuel/import_stations.py).

Séparé de price_pipeline_dag, et volontairement :

- **pas de délai aléatoire.** Celui du scrape Amazon sert à ne pas se présenter
  à heure fixe devant un anti-bot ; ici on lit une API publique faite pour être
  interrogée.
- **pas de dépendance au scrape.** Une panne côté Amazon ne doit pas figer les
  prix des carburants, et inversement.

Toutes les 30 minutes, jour et nuit (cron `*/30`, à :00 et :30 heure de Paris
— le `start_date` porte le fuseau). Le flux se rafraîchit toutes les 10 à
15 minutes : une demi-heure garde les prix et les ruptures à jour sans relire
deux fois la même version, et l'alerte de réapprovisionnement (qui ne voit un
retour en stock qu'au moment d'un import) part dans la demi-heure.

Un run doit tenir dans cet intervalle, sinon `max_active_runs=1` empile les
suivants : timeout de 10 min, une seule relance après 5 min, soit 25 min au
pire. Un import raté n'a pas besoin de plus — le suivant arrive 30 min après.
"""
from datetime import timedelta

import pendulum
from airflow import DAG

from pipeline_tasks import REGISTRY, build_task

default_args = {
    "owner": "airflow",
    # 10 + 5 + 10 = 25 min au pire : le run se termine avant le suivant.
    "retries": 1,
    "retry_delay": timedelta(minutes=5),
    # Un seul appel HTTP et ~10 000 upserts : quelques dizaines de secondes en
    # temps normal. Au-delà, l'API est en difficulté et le run suivant fera mieux.
    "execution_timeout": timedelta(minutes=10),
}

with DAG(
    dag_id="fuel_prices_dag",
    description="Import du flux officiel des prix des carburants -> fuel_stations",
    default_args=default_args,
    schedule="*/30 * * * *",
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

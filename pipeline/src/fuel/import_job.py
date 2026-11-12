"""Tâche d'import des prix carburants, toutes les 30 minutes (DAG `fuel_prices`).

    python -m src.fuel.import_stations

Dans cet ordre :

1. télécharger le flux officiel, puis l'export OSM des enseignes (s'il est
   indisponible, on garde les enseignes connues) ;
2. remplacer `fuel_stations` — seule étape qui peut faire échouer la tâche
   (`TruncatedFeedError`) ;
3. reporter les ruptures dans `fuel_shortages`, même sans alerte configurée,
   pour qu'un modèle activé plus tard ait son passé ;
4. publier les prévisions de rupture puis de réapprovisionnement des stations
   favorites, qui lisent les ruptures de cet import (donc après 3) ;
5. alerter, si un webhook est configuré.

Les étapes 3 à 5 ne lèvent jamais : les prix sont importés, c'est l'essentiel.
"""
import os
from datetime import datetime

from pymongo.database import Database

from src.clock import naive_utc_now
from src.database import open_database
from src.fuel.alerts import FuelAlertConfig, alert_fuel_events
from src.fuel.brands import fetch_osm_stations
from src.fuel.import_stations import fetch_records, import_stations
from src.fuel.restock_forecast.forecasts import publish_restock_forecasts
from src.fuel.shortage_forecast import episodes
from src.fuel.shortage_forecast.forecasts import publish_forecasts


def main() -> None:
    records = fetch_records()
    brands = _fetch_brands()
    alert_config = FuelAlertConfig.from_env(os.environ)
    imported_at = naive_utc_now()
    with open_database() as db:
        count = import_stations(db, records, brands, now=imported_at)
        branded = db["fuel_stations"].count_documents({"brand": {"$ne": None}})
        print(f"fuel_stations: {count} stations imported ({len(records)} records received)")
        print(f"brands: {branded}/{count} stations matched to a brand")
        publish_after_import(db, imported_at, alert_config)


def publish_after_import(db: Database, imported_at: datetime, alert_config: FuelAlertConfig | None) -> None:
    """Étapes 3 à 5 : ce qui découle des prix qu'on vient d'importer."""
    _record_shortages(db, imported_at)
    risks = publish_forecasts(db, imported_at)
    publish_restock_forecasts(db, imported_at)
    if alert_config:
        alert_fuel_events(db, alert_config, imported_at, risks)


def _fetch_brands() -> dict[str, dict] | None:
    """Enseignes OSM, ou None (export indisponible : `import_stations` garde
    alors les enseignes déjà connues)."""
    try:
        return fetch_osm_stations()
    except (OSError, ValueError) as error:
        print(f"brands: OSM export unavailable ({error}), keeping known brands")
        return None


def _record_shortages(db: Database, imported_at: datetime) -> None:
    try:
        opened, closed = episodes.record_live(db, imported_at)
        print(f"fuel_shortages: {opened} rupture(s) en cours, {closed} close(s) à cet import")
    except Exception as error:  # noqa: BLE001 — les prix sont importés, c'est l'essentiel
        print(f"fuel_shortages: mise à jour impossible ({error!r})")

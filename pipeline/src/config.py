"""Configuration du pipeline, lue dans l'environnement (ou `pipeline/.env`).

`MONGODB_URI` est lue à l'appel de `mongodb_uri()`, pas à l'import : un
module peut importer `src.config` sans exiger de base, ce que font les tests.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# Nom de base unique du projet, en dur aussi dans le scrapper et le backend.
DB_NAME = "scrapper"


def mongodb_uri() -> str:
    """Lève une KeyError nommant la variable si elle manque."""
    return os.environ["MONGODB_URI"]

"""Ouverture de la base, réservée aux points d'entrée (`__main__`, `run`).

Les fonctions du pipeline reçoivent `db` en paramètre et n'ouvrent jamais de
connexion elles-mêmes : c'est ce qui permet aux tests de leur passer un
`mongomock`.
"""
from collections.abc import Iterator
from contextlib import contextmanager

from pymongo import MongoClient
from pymongo.database import Database

from src.config import DB_NAME, mongodb_uri


@contextmanager
def open_database() -> Iterator[Database]:
    """La base du projet ; la connexion est fermée à la sortie du bloc."""
    client = MongoClient(mongodb_uri())
    try:
        yield client[DB_NAME]
    finally:
        client.close()

"""Fixtures communes aux tests du pipeline.

`src.config` lit `MONGODB_URI` dans l'environnement *à l'import* et lève une
KeyError s'il est absent : on fournit donc une valeur factice avant tout import
de `src.*`. Aucun test n'ouvre de vraie connexion — la base est un mongomock.
"""
import os
from datetime import datetime, timedelta

os.environ.setdefault("MONGODB_URI", "mongodb://localhost:27017")

import mongomock
import pytest


@pytest.fixture
def db():
    """Base mongomock vide, remplacée à chaque test."""
    return mongomock.MongoClient()["scrapper"]


@pytest.fixture
def today():
    """Minuit aujourd'hui, naïf.

    Les dates écrites par le scrapper puis relues par pandas sont naïves : le
    filtre d'obsolescence de `score()` compare `day` à un `datetime` sans
    fuseau, et mélanger les deux lèverait une TypeError.
    """
    return datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)


def money(amount, currency="EUR"):
    return {"amount": amount, "currency": currency}


def snapshot(day, amount, currency="EUR", **extra):
    """Un relevé quotidien tel qu'il figure dans `price_history.history`."""
    entry = {
        "day": day,
        "price": money(amount, currency) if amount is not None else None,
        "crossedOutPrice": None,
        "unitPrice": None,
        "scrapedAt": day + timedelta(hours=6),
    }
    entry.update(extra)
    return entry


def price_history_doc(url, prices, last_day, **extra):
    """Document `price_history` dont les prix se terminent à `last_day`.

    `prices` est listé du plus ancien au plus récent, un par jour consécutif.
    """
    first_day = last_day - timedelta(days=len(prices) - 1)
    doc = {
        "_id": url,
        "keyword": "lessive",
        "shop": "amazon",
        "title": f"Produit {url}",
        "images": [],
        "firstSeen": first_day,
        "lastSeen": last_day,
        "history": [
            snapshot(first_day + timedelta(days=i), price) for i, price in enumerate(prices)
        ],
    }
    doc.update(extra)
    return doc

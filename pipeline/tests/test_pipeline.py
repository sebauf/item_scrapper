"""Orchestration : purge, refine puis score, dans cet ordre et sur la même base.

L'ordre n'est pas cosmétique. `score` lit `price_history`, que `refine` vient
d'écrire : les inverser ferait scorer les prix de la veille sans que rien
n'échoue visiblement. Et la purge passe *avant* le refine, qui reconstruit
`price_history` depuis `items_raw` — purger après le refine laisserait le
pipeline réécrire le document qu'on vient de supprimer.
"""
import mongomock
import pytest

from src import pipeline
from src.config import DB_NAME


@pytest.fixture
def calls(monkeypatch):
    """Remplace les trois étapes par des témoins, et Mongo par un mongomock."""
    client = mongomock.MongoClient()
    monkeypatch.setattr(pipeline, "MongoClient", lambda uri: client)

    recorded = []

    def purge(db):
        recorded.append(("purge", db))
        return 1

    def refine(db):
        recorded.append(("refine", db))
        return 3

    def score(db):
        recorded.append(("score", db))
        return 2

    monkeypatch.setattr(pipeline, "purge_dead_products", purge)
    monkeypatch.setattr(pipeline, "build_price_history", refine)
    monkeypatch.setattr(pipeline, "score", score)
    return recorded


def test_enchaine_purge_refine_puis_score(calls):
    pipeline.run()

    assert [step for step, _ in calls] == ["purge", "refine", "score"]


def test_les_etapes_partagent_la_base(calls):
    pipeline.run()

    bases = {db.name for _, db in calls}
    assert bases == {DB_NAME}


def test_affiche_les_compteurs(calls, capsys):
    pipeline.run()

    out = capsys.readouterr().out
    assert "purge: 1 dead products removed" in out
    assert "price_history: 3 products refreshed" in out
    assert "deal_scores: 2 products scored" in out


def test_nom_de_base_stable():
    """Le nom est en dur dans le scrapper, le backend et le pipeline."""
    assert DB_NAME == "scrapper"

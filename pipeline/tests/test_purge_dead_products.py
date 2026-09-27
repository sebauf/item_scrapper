"""La purge supprime pour de bon : chaque test décrit donc autant ce qu'elle
efface que ce qu'elle doit laisser tranquille.

Les dates sont posées relativement au dernier passage du scrapper, jamais à
`datetime.now()` — c'est exactement ce que le code sous test doit faire, et
l'écrire ainsi dans les tests rend un retour à `now()` visible.
"""
from datetime import timedelta

import pytest

from src.maintenance.purge_dead_products import PURGE_AFTER_DAYS, purge_dead_products

from tests.conftest import money


@pytest.fixture
def last_scrape(today):
    return today


def item(url, day, price=10.0, title=None, keyword="lessive"):
    return {
        "url": url,
        "day": day,
        "scrapedAt": day + timedelta(hours=6),
        "keyword": keyword,
        "shop": "amazon",
        "title": f"Produit {url}" if title is None else title,
        "price": money(price) if price is not None else None,
        "images": [],
    }


def seed(db, rows):
    db["items_raw"].insert_many(rows)


def urls_left(db):
    return sorted({doc["url"] for doc in db["items_raw"].find({})})


def test_supprime_un_produit_sans_releve_utile_depuis_plus_de_quinze_jours(db, last_scrape):
    seed(
        db,
        [
            item("mort", last_scrape - timedelta(days=PURGE_AFTER_DAYS + 1)),
            item("vivant", last_scrape),
        ],
    )

    assert purge_dead_products(db) == 1
    assert urls_left(db) == ["vivant"]


def test_garde_un_produit_releve_pile_a_la_limite(db, last_scrape):
    # « plus de quinze jours » : à quinze jours pile, le produit reste.
    seed(db, [item("limite", last_scrape - timedelta(days=PURGE_AFTER_DAYS)), item("x", last_scrape)])

    assert purge_dead_products(db) == 0
    assert "limite" in urls_left(db)


def test_un_releve_degrade_ne_compte_pas_comme_un_rafraichissement(db, last_scrape):
    # Page encore atteignable mais sans prix pendant des semaines : le produit
    # n'est affichable nulle part, il ne mérite pas une requête par jour.
    seed(
        db,
        [item("sans_prix", last_scrape - timedelta(days=d), price=None) for d in range(0, 20)]
        + [item("sans_prix", last_scrape - timedelta(days=PURGE_AFTER_DAYS + 5))],
    )

    assert purge_dead_products(db) == 1
    assert urls_left(db) == []


def test_laisse_sa_chance_a_un_produit_recent_encore_sans_prix(db, last_scrape):
    seed(db, [item("nouveau", last_scrape, price=None), item("x", last_scrape)])

    assert purge_dead_products(db) == 0
    assert "nouveau" in urls_left(db)


def test_supprime_aussi_price_history_et_deal_scores(db, last_scrape):
    seed(db, [item("mort", last_scrape - timedelta(days=30)), item("vivant", last_scrape)])
    db["price_history"].insert_many([{"_id": "mort"}, {"_id": "vivant"}])
    db["deal_scores"].insert_many([{"_id": "mort", "score": 40.0}, {"_id": "vivant", "score": 10.0}])

    purge_dead_products(db)

    assert [doc["_id"] for doc in db["price_history"].find({})] == ["vivant"]
    assert [doc["_id"] for doc in db["deal_scores"].find({})] == ["vivant"]


def test_epargne_les_url_suivies_a_l_unite(db, last_scrape):
    seed(db, [item("suivi", last_scrape - timedelta(days=60)), item("x", last_scrape)])
    db["tracked_urls"].insert_one({"url": "suivi", "enabled": True})

    assert purge_dead_products(db) == 0
    assert "suivi" in urls_left(db)


def test_epargne_les_favoris(db, last_scrape):
    seed(db, [item("favori", last_scrape - timedelta(days=60)), item("x", last_scrape)])
    db["favorites"].insert_one({"url": "favori"})

    assert purge_dead_products(db) == 0
    assert "favori" in urls_left(db)


def test_la_fenetre_part_du_dernier_passage_pas_de_maintenant(db, today):
    # Scrapper en panne depuis un mois : au redémarrage du pipeline, tout le
    # catalogue a « plus de quinze jours » au sens de l'horloge. Rien ne doit
    # partir pour autant — sinon une panne de scrapper devient une perte de
    # données.
    panne = today - timedelta(days=30)
    seed(db, [item("a", panne), item("b", panne - timedelta(days=3))])

    assert purge_dead_products(db) == 0
    assert urls_left(db) == ["a", "b"]


def test_ne_touche_a_rien_sur_une_base_vide(db):
    assert purge_dead_products(db) == 0


def test_supprime_tous_les_jours_du_produit_mort(db, last_scrape):
    # Un produit mort traîne un document par jour vécu : c'est le volume que la
    # purge doit récupérer, pas seulement la dernière ligne.
    seed(
        db,
        [item("mort", last_scrape - timedelta(days=d)) for d in range(20, 40)]
        + [item("vivant", last_scrape)],
    )

    assert purge_dead_products(db) == 1
    assert db["items_raw"].count_documents({}) == 1

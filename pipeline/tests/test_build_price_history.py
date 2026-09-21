"""Agrégation `items_raw` → `price_history`.

Les tests tournent sur mongomock : le pipeline d'agrégation est réellement
exécuté, donc un $group ou un $push mal écrit échoue ici et pas seulement en
production.
"""
from datetime import datetime, timedelta

from src.refine.build_price_history import build_price_history

D = datetime(2025, 6, 1)


def raw_item(url, day, price, **extra):
    item = {
        "url": url,
        "day": day,
        "shop": "amazon",
        "keyword": "lessive",
        "title": f"Titre {day:%d}",
        "images": [f"img-{day:%d}.jpg"],
        "price": {"amount": price, "currency": "EUR"},
        "crossedOutPrice": None,
        "unitPrice": None,
        "scrapedAt": day + timedelta(hours=6),
    }
    item.update(extra)
    return item


class TestBuildPriceHistory:
    def test_un_document_par_url(self, db):
        db["items_raw"].insert_many([
            raw_item("u1", D, 10.0),
            raw_item("u1", D + timedelta(days=1), 9.0),
            raw_item("u2", D, 50.0),
        ])

        assert build_price_history(db) == 2
        assert db["price_history"].count_documents({}) == 2
        assert db["price_history"].find_one({"_id": "u1"})["_id"] == "u1"

    def test_historique_trie_et_complet(self, db):
        db["items_raw"].insert_many([
            raw_item("u1", D + timedelta(days=1), 9.0),
            raw_item("u1", D, 10.0),
        ])
        build_price_history(db)

        history = db["price_history"].find_one({"_id": "u1"})["history"]
        assert [entry["day"] for entry in history] == [D, D + timedelta(days=1)]
        assert [entry["price"]["amount"] for entry in history] == [10.0, 9.0]

    def test_metadonnees_issues_du_releve_le_plus_recent(self, db):
        """Un produit renommé ou re-photographié doit afficher sa version du jour."""
        db["items_raw"].insert_many([
            raw_item("u1", D, 10.0, title="Ancien titre", images=["vieux.jpg"]),
            raw_item("u1", D + timedelta(days=1), 9.0, title="Nouveau titre", images=["neuf.jpg"]),
        ])
        build_price_history(db)

        doc = db["price_history"].find_one({"_id": "u1"})
        assert doc["title"] == "Nouveau titre"
        assert doc["images"] == ["neuf.jpg"]
        assert doc["shop"] == "amazon"
        assert doc["keyword"] == "lessive"

    def test_bornes_de_suivi(self, db):
        db["items_raw"].insert_many([
            raw_item("u1", D, 10.0),
            raw_item("u1", D + timedelta(days=5), 9.0),
            raw_item("u1", D + timedelta(days=2), 11.0),
        ])
        build_price_history(db)

        doc = db["price_history"].find_one({"_id": "u1"})
        assert doc["firstSeen"] == D
        assert doc["lastSeen"] == D + timedelta(days=5)
        assert isinstance(doc["updatedAt"], datetime)

    def test_sans_relevé_brut_n_écrit_rien(self, db):
        assert build_price_history(db) == 0
        assert db["price_history"].count_documents({}) == 0

    def test_idempotent(self, db):
        """Rejouer le refine après un nouveau scrape ne duplique rien."""
        db["items_raw"].insert_one(raw_item("u1", D, 10.0))
        build_price_history(db)

        db["items_raw"].insert_one(raw_item("u1", D + timedelta(days=1), 8.0))
        assert build_price_history(db) == 1

        docs = list(db["price_history"].find())
        assert len(docs) == 1
        assert len(docs[0]["history"]) == 2

    def test_conserve_le_drapeau_unavailable(self, db):
        """`unavailable` est posé par le scrapper : le refine ne doit pas l'effacer.

        L'écriture se fait en `$set` des seuls champs recalculés, jamais en
        remplacement du document — sinon un produit confirmé indisponible
        redeviendrait scorable au premier refine suivant.
        """
        db["price_history"].insert_one(
            {"_id": "u1", "unavailable": True, "unavailableSince": D}
        )
        db["items_raw"].insert_one(raw_item("u1", D, 10.0))

        build_price_history(db)

        doc = db["price_history"].find_one({"_id": "u1"})
        assert doc["unavailable"] is True
        assert doc["unavailableSince"] == D
        assert len(doc["history"]) == 1

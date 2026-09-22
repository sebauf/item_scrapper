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


class TestIdentiteArticle:
    """Remontée des champs qui servent au rapprochement inter-enseignes.

    Ils ne suivent pas la même règle que le titre ou les images : ceux-là
    changent légitimement et le dernier relevé fait autorité, tandis qu'un
    code-barres absent d'un relevé signale une page dégradée, pas un
    changement d'article.
    """

    IDENTITY = {
        "ean": "3014260610807",
        "brand": "Ariel",
        "mpn": "8001841234567",
        "quantity": {"amount": 1.5, "unit": "L"},
        "packSize": None,
        "doses": 60,
    }

    def test_identite_remontee_sur_le_document(self, db):
        db["items_raw"].insert_one(raw_item("u1", D, 10.0, **self.IDENTITY))
        build_price_history(db)

        doc = db["price_history"].find_one({"_id": "u1"})
        assert doc["ean"] == "3014260610807"
        assert doc["brand"] == "Ariel"
        assert doc["mpn"] == "8001841234567"
        assert doc["quantity"] == {"amount": 1.5, "unit": "L"}
        assert doc["doses"] == 60

    def test_un_releve_degrade_n_efface_pas_l_identite(self, db):
        """Le cœur de la règle : Amazon rend parfois une page sans sa section
        « Informations sur le produit ». Avec un simple $last, l'EAN du produit
        disparaîtrait — et avec lui sa seule clé de rapprochement."""
        db["items_raw"].insert_many([
            raw_item("u1", D, 10.0, **self.IDENTITY),
            raw_item("u1", D + timedelta(days=1), 9.0, ean=None, brand=None, quantity=None),
        ])
        build_price_history(db)

        doc = db["price_history"].find_one({"_id": "u1"})
        assert doc["ean"] == "3014260610807"
        assert doc["brand"] == "Ariel"
        assert doc["quantity"] == {"amount": 1.5, "unit": "L"}

    def test_une_identite_corrigee_remplace_la_precedente(self, db):
        """« Dernière non nulle » et non « première » : si Amazon corrige la
        fiche, c'est la valeur récente qui fait foi."""
        db["items_raw"].insert_many([
            raw_item("u1", D, 10.0, ean="3014260610807"),
            raw_item("u1", D + timedelta(days=1), 9.0, ean=None),
            raw_item("u1", D + timedelta(days=2), 9.0, ean="4005809001209"),
        ])
        build_price_history(db)

        assert db["price_history"].find_one({"_id": "u1"})["ean"] == "4005809001209"

    def test_produit_sans_identite_expose_des_champs_nuls(self, db):
        """Cas des relevés antérieurs à l'extraction d'identité : les champs
        doivent exister et valoir null, pas manquer — sinon l'étage de
        rapprochement devra distinguer « absent » de « inconnu »."""
        db["items_raw"].insert_one(raw_item("u1", D, 10.0))
        build_price_history(db)

        doc = db["price_history"].find_one({"_id": "u1"})
        for field in ("ean", "brand", "mpn", "quantity", "packSize", "doses"):
            assert field in doc, f"{field} absent du document"
            assert doc[field] is None

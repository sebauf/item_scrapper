"""Scoring d'un produit contre son propre historique.

Trois garde-fous sont testés ici parce que chacun a une conséquence visible sur
le site : le minimum d'observations (un score calculé sur deux relevés ne veut
rien dire), la fraîcheur (un produit disparu garderait sinon son dernier prix
comme « affaire du jour ») et le drapeau `unavailable` (signal direct, plus fort
que l'ancienneté).
"""
from datetime import timedelta

import pandas as pd
import pytest

from src.scoring.features import PRICE_COLUMN
from src.scoring.score import MIN_OBSERVATIONS, _trend_direction, score
from tests.conftest import price_history_doc

# 6 relevés : le dernier a donc exactement MIN_OBSERVATIONS observations
# antérieures, soit le minimum tout juste atteint.
STABLE_THEN_DROP = [10.0, 10.0, 10.0, 10.0, 10.0, 8.0]


class TestScore:
    def test_score_un_produit_eligible(self, db, today):
        db["price_history"].insert_one(price_history_doc("u1", STABLE_THEN_DROP, today))

        assert score(db) == 1

        doc = db["deal_scores"].find_one({"_id": "u1"})
        # (10 - 8) / 10 * 100
        assert doc["score"] == 20.0
        assert doc["predictedPrice"] == 10.0
        assert doc["actualPrice"] == 8.0
        assert doc["currency"] == "EUR"
        assert doc["trendDirection"] == "down"
        assert doc["computedAt"] is not None

    def test_prix_au_dessus_de_la_moyenne_donne_un_score_negatif(self, db, today):
        db["price_history"].insert_one(
            price_history_doc("u1", [8.0, 8.0, 8.0, 8.0, 8.0, 10.0], today)
        )
        score(db)

        doc = db["deal_scores"].find_one({"_id": "u1"})
        assert doc["score"] == -25.0
        assert doc["trendDirection"] == "up"

    def test_arrondis(self, db, today):
        db["price_history"].insert_one(
            price_history_doc("u1", [10.0, 11.0, 12.0, 13.0, 14.0, 9.99], today)
        )
        score(db)

        doc = db["deal_scores"].find_one({"_id": "u1"})
        assert doc["score"] == round((12.0 - 9.99) / 12.0 * 100, 1)
        assert doc["predictedPrice"] == 12.0

    def test_trop_peu_d_observations(self, db, today):
        """5 relevés = 4 observations antérieures : sous le minimum."""
        db["price_history"].insert_one(price_history_doc("u1", [10.0] * 4 + [8.0], today))

        assert score(db) == 0
        assert db["deal_scores"].count_documents({}) == 0

    def test_produit_obsolete_ignore(self, db, today):
        db["price_history"].insert_one(
            price_history_doc("u1", STABLE_THEN_DROP, today - timedelta(days=3))
        )

        assert score(db) == 0

    def test_produit_relevé_hier_reste_eligible(self, db, today):
        db["price_history"].insert_one(
            price_history_doc("u1", STABLE_THEN_DROP, today - timedelta(days=1))
        )

        assert score(db) == 1

    def test_dernier_prix_ancien_malgré_un_historique_recent(self, db, today):
        """Le produit est encore relevé, mais sans prix depuis 4 jours.

        Sans le contrôle de fraîcheur, la dernière ligne *avec prix* ferait
        passer un prix vieux de 4 jours pour l'affaire du moment.
        """
        db["price_history"].insert_one(
            price_history_doc("u1", STABLE_THEN_DROP + [None, None, None, None], today)
        )

        assert score(db) == 0

    def test_produit_marque_indisponible_ignore(self, db, today):
        db["price_history"].insert_one(
            price_history_doc("u1", STABLE_THEN_DROP, today, unavailable=True)
        )

        assert score(db) == 0
        assert db["deal_scores"].count_documents({}) == 0

    def test_drapeau_leve_ne_bloque_pas(self, db, today):
        """`unavailable: False` = produit revenu en stock, à scorer normalement."""
        db["price_history"].insert_one(
            price_history_doc("u1", STABLE_THEN_DROP, today, unavailable=False)
        )

        assert score(db) == 1

    def test_observations_sans_aucun_prix(self, db, today):
        """Assez de relevés, mais aucun prix antérieur : pas de moyenne, pas de score."""
        db["price_history"].insert_one(
            price_history_doc("u1", [None] * 5 + [8.0], today)
        )

        assert score(db) == 0

    def test_purge_les_scores_devenus_invalides(self, db, today):
        """Un score qui ne serait plus recalculé doit disparaître, pas survivre."""
        db["deal_scores"].insert_many([
            {"_id": "u-obsolete", "score": 99.0},
            {"_id": "u-ancien-modele", "score": 42.0},
        ])
        db["price_history"].insert_one(price_history_doc("u1", STABLE_THEN_DROP, today))

        score(db)

        assert {doc["_id"] for doc in db["deal_scores"].find()} == {"u1"}

    def test_base_vide_vide_les_scores(self, db):
        db["deal_scores"].insert_one({"_id": "u-orphelin", "score": 10.0})

        assert score(db) == 0
        assert db["deal_scores"].count_documents({}) == 0

    def test_relance_met_a_jour_sans_dupliquer(self, db, today):
        db["price_history"].insert_one(price_history_doc("u1", STABLE_THEN_DROP, today))
        score(db)
        first = db["deal_scores"].find_one({"_id": "u1"})["computedAt"]

        assert score(db) == 1
        assert db["deal_scores"].count_documents({}) == 1
        assert db["deal_scores"].find_one({"_id": "u1"})["computedAt"] >= first

    def test_plusieurs_produits(self, db, today):
        db["price_history"].insert_many([
            price_history_doc("u1", STABLE_THEN_DROP, today),
            price_history_doc("u2", [20.0] * 5 + [20.0], today),
            price_history_doc("u3", [5.0, 5.0], today),  # trop peu d'observations
        ])

        assert score(db) == 2
        assert {doc["_id"] for doc in db["deal_scores"].find()} == {"u1", "u2"}
        assert db["deal_scores"].find_one({"_id": "u2"})["score"] == 0.0

    def test_le_minimum_est_bien_de_cinq(self):
        assert MIN_OBSERVATIONS == 5


class TestTrendDirection:
    @staticmethod
    def frame(prices, today):
        days = [today - timedelta(days=len(prices) - 1 - i) for i in range(len(prices))]
        return pd.DataFrame({"url": ["u1"] * len(prices), "day": days, PRICE_COLUMN: prices})

    @pytest.mark.parametrize(
        "prices,expected",
        [
            ([20.0, 18.0, 16.0, 14.0, 12.0], "down"),
            ([12.0, 14.0, 16.0, 18.0, 20.0], "up"),
            ([10.0, 10.0, 10.0, 10.0, 10.0], "stable"),
            # Variation sous le seuil de 0,5 %/jour : du bruit, pas une tendance.
            ([100.0, 100.2, 100.1, 100.3, 100.4], "stable"),
        ],
    )
    def test_sens_de_la_tendance(self, prices, expected, today):
        assert _trend_direction(self.frame(prices, today), "u1") == expected

    def test_prix_nuls_sans_division_par_zero(self, today):
        assert _trend_direction(self.frame([0.0, 0.0, 0.0], today), "u1") == "stable"

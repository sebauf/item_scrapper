"""Scoring d'un produit contre son propre historique.

Trois garde-fous sont testés ici parce que chacun a une conséquence visible sur
le site : le minimum d'observations (un score calculé sur deux relevés ne veut
rien dire), la fraîcheur (un produit disparu garderait sinon son dernier prix
comme « affaire du jour ») et le drapeau `unavailable` (signal direct, plus fort
que l'ancienneté).
"""
from datetime import timedelta

import numpy as np
import pandas as pd
import pytest

from src.scoring.features import PRICE_COLUMN, extract_rows
from src.scoring.score import (
    MIN_OBSERVATIONS,
    _same_day_move,
    _trend_direction,
    score,
    theil_sen_slope,
)
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
        # -20 % sous une fourchette habituelle de ±5 % : signalé le jour même.
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


class TestReferenceRobuste:
    def test_un_releve_aberrant_ne_fabrique_pas_d_affaire(self, db, today):
        """Sans filtre : référence 114,3 €, score +60,6 %. Avec : 50 €, +10 %."""
        db["price_history"].insert_one(
            price_history_doc("u1", [50.0, 50.0, 500.0, 50.0, 50.0, 50.0, 45.0], today)
        )

        assert score(db) == 1

        doc = db["deal_scores"].find_one({"_id": "u1"})
        assert doc["predictedPrice"] == 50.0
        assert doc["score"] == 10.0

    def test_le_minimum_porte_sur_les_releves_conserves(self, db, today):
        """5 relevés antérieurs dont 1 aberrant = 4 points de référence : insuffisant."""
        db["price_history"].insert_one(
            price_history_doc("u1", [50.0, 50.0, 500.0, 50.0, 50.0, 45.0], today)
        )

        assert score(db) == 0


class TestBaisseDuJour:
    """La tendance doit signaler une baisse le jour même où elle apparaît."""

    def test_petite_variation_dans_la_fourchette_n_est_pas_signalee(self, db, today):
        """-2 % sur un prix stable : sous le plancher de ±5 %, c'est du bruit."""
        db["price_history"].insert_one(
            price_history_doc("u1", [10.0] * 5 + [9.8], today)
        )
        score(db)

        assert db["deal_scores"].find_one({"_id": "u1"})["trendDirection"] == "stable"

    def test_baisse_du_jour_malgre_un_releve_aberrant_passe(self, db, today):
        """Un 500 € dans l'historique ne masque ni la référence ni la baisse."""
        db["price_history"].insert_one(
            price_history_doc("u1", [50.0, 50.0, 500.0, 50.0, 50.0, 50.0, 45.0], today)
        )
        score(db)

        assert db["deal_scores"].find_one({"_id": "u1"})["trendDirection"] == "down"

    def test_produit_volatil_fourchette_plus_large(self, today):
        """Un prix qui oscille de ±10 % au quotidien : -8 % n'a rien d'inhabituel.

        La MAD élargit la fourchette (≈ 70–143 €) : pas de mouvement du jour.
        """
        prices = [100.0, 110.0, 90.0, 108.0, 92.0, 100.0, 92.0]
        latest = extract_rows(price_history_doc("u1", prices, today))[-1]

        assert _same_day_move(latest) is None
        # Le même -8 % sur un produit stable, lui, est signalé.
        stable = extract_rows(price_history_doc("u1", [100.0] * 6 + [92.0], today))[-1]
        assert _same_day_move(stable) == "down"


class TestSameDayMove:
    @staticmethod
    def row(price, low=9.5, high=10.5):
        return {PRICE_COLUMN: price, "usual_low_30d": low, "usual_high_30d": high}

    @pytest.mark.parametrize(
        "price,expected",
        [(8.0, "down"), (12.0, "up"), (10.0, None), (9.6, None), (10.4, None)],
    )
    def test_position_par_rapport_a_la_fourchette(self, price, expected):
        assert _same_day_move(self.row(price)) == expected

    def test_sans_fourchette(self):
        assert _same_day_move(self.row(8.0, low=None, high=None)) is None


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

    def test_un_releve_aberrant_ne_cree_pas_de_tendance(self, today):
        """Un prix lu à ×10 : les moindres carrés concluraient à une hausse."""
        prices = [10.0, 10.0, 10.0, 10.0, 10.0, 100.0, 10.0]
        assert _trend_direction(self.frame(prices, today), "u1") == "stable"

    def test_un_releve_aberrant_n_inverse_pas_une_vraie_baisse(self, today):
        prices = [20.0, 19.0, 18.0, 17.0, 170.0, 15.0, 14.0]
        assert _trend_direction(self.frame(prices, today), "u1") == "down"

    def test_une_baisse_qui_dure_devient_une_tendance(self, today):
        """Un jour à 8 € est un saut ; trois jours de suite, c'est une trajectoire."""
        prices = [10.0] * 5 + [8.0] * 3
        assert _trend_direction(self.frame(prices, today), "u1") == "down"

    def test_un_seul_releve(self, today):
        assert _trend_direction(self.frame([10.0], today), "u1") == "stable"


class TestTheilSenSlope:
    def test_droite_exacte(self):
        days = np.arange(5, dtype=float)
        assert theil_sen_slope(days, 3.0 * days + 7.0) == pytest.approx(3.0)

    def test_insensible_a_un_point_aberrant(self):
        days = np.arange(7, dtype=float)
        prices = 3.0 * days + 7.0
        prices[3] = 1000.0
        assert theil_sen_slope(days, prices) == pytest.approx(3.0)

    def test_sans_paire_de_jours_distincts(self):
        assert theil_sen_slope(np.array([0.0]), np.array([10.0])) is None

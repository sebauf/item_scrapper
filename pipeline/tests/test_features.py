"""Extraction des séries temporelles par produit.

Deux règles protégées ici :

- `baseline_price_30d`, `n_inliers` et `n_observations` ne regardent *que* les
  jours antérieurs. Si le prix du jour entrait dans sa propre référence, un
  produit soldé une seule fois se comparerait en partie à lui-même et son
  score serait mécaniquement amorti ;
- la référence résiste aux relevés aberrants (filtre de Hampel) : un seul prix
  mal lu ne doit pas fabriquer une « affaire » pour les 30 jours suivants.
"""
from datetime import datetime, timedelta

import pandas as pd
import pytest

from src.scoring.features import (
    PRICE_COLUMN,
    build_frame,
    extract_rows,
    latest_rows_only,
    robust_baseline,
    usual_price_range,
)
from tests.conftest import snapshot

D = datetime(2025, 6, 1)


def doc(history, url="u1"):
    return {"_id": url, "history": history}


class TestExtractRows:
    def test_historique_absent_ou_vide(self):
        assert extract_rows(doc([])) == []
        assert extract_rows({"_id": "u1"}) == []

    def test_trie_l_historique_par_jour(self):
        rows = extract_rows(
            doc([snapshot(D, 30.0), snapshot(D - timedelta(days=2), 10.0), snapshot(D - timedelta(days=1), 20.0)])
        )
        assert [row["day"] for row in rows] == [D - timedelta(days=2), D - timedelta(days=1), D]

    def test_premier_releve_sans_moyenne(self):
        [row] = extract_rows(doc([snapshot(D, 12.5)]))
        assert row["baseline_price_30d"] is None
        assert row["n_observations"] == 0
        assert row[PRICE_COLUMN] == 12.5
        assert row["url"] == "u1"

    def test_la_moyenne_exclut_le_prix_du_jour(self):
        rows = extract_rows(
            doc([
                snapshot(D - timedelta(days=2), 10.0),
                snapshot(D - timedelta(days=1), 20.0),
                snapshot(D, 90.0),
            ])
        )
        assert rows[-1]["baseline_price_30d"] == 15.0
        assert rows[-1]["n_observations"] == 2

    def test_fenetre_glissante_de_30_jours(self):
        """31 jours en arrière est hors fenêtre, 30 jours y est encore."""
        rows = extract_rows(
            doc([
                snapshot(D - timedelta(days=31), 100.0),
                snapshot(D - timedelta(days=30), 200.0),
                snapshot(D, 300.0),
            ])
        )
        assert rows[-1]["baseline_price_30d"] == 200.0
        # `n_observations` compte tout l'historique, pas seulement la fenêtre :
        # c'est un indicateur de fiabilité du produit, pas de la moyenne.
        assert rows[-1]["n_observations"] == 2

    def test_un_jour_sans_prix_ne_produit_pas_de_ligne(self):
        rows = extract_rows(
            doc([
                snapshot(D - timedelta(days=2), 10.0),
                snapshot(D - timedelta(days=1), None),
                snapshot(D, 20.0),
            ])
        )
        assert [row["day"] for row in rows] == [D - timedelta(days=2), D]
        # Le jour sans prix compte comme observation mais n'entre pas dans la moyenne.
        assert rows[-1]["n_observations"] == 2
        assert rows[-1]["baseline_price_30d"] == 10.0
        assert rows[-1]["n_inliers"] == 1

    def test_un_releve_aberrant_ne_deplace_pas_la_reference(self):
        """Cas réel : un prix lu à 500 € au milieu de relevés à 50 €.

        Avec une moyenne simple, la référence monterait à 114,3 € et un prix
        du jour à 45 € passerait pour une remise de 60 %.
        """
        prices = [50.0, 50.0, 50.0, 500.0, 50.0, 50.0, 50.0]
        history = [snapshot(D - timedelta(days=len(prices) - i), p) for i, p in enumerate(prices)]
        rows = extract_rows(doc(history + [snapshot(D, 45.0)]))

        assert rows[-1]["baseline_price_30d"] == 50.0
        assert rows[-1]["n_inliers"] == 6
        # Le relevé écarté reste une observation : il a bien eu lieu.
        assert rows[-1]["n_observations"] == 7

    def test_une_promo_passee_ne_fait_pas_baisser_la_reference(self):
        """20 jours à 50 €, puis 10 jours de promo à 35 € : le prix habituel reste 50 €."""
        prices = [50.0] * 20 + [35.0] * 10
        history = [snapshot(D - timedelta(days=len(prices) - i), p) for i, p in enumerate(prices)]
        rows = extract_rows(doc(history + [snapshot(D, 45.0)]))

        assert rows[-1]["baseline_price_30d"] == 50.0
        assert rows[-1]["n_inliers"] == 20

    def test_le_prix_du_jour_n_est_jamais_filtre(self):
        """Une vraie bonne affaire est une valeur extrême : c'est elle qu'on cherche."""
        history = [snapshot(D - timedelta(days=5 - i), 50.0) for i in range(5)]
        rows = extract_rows(doc(history + [snapshot(D, 5.0)]))

        assert rows[-1][PRICE_COLUMN] == 5.0
        assert rows[-1]["baseline_price_30d"] == 50.0

    def test_conserve_la_devise(self):
        [row] = extract_rows(doc([snapshot(D, 10.0, currency="USD")]))
        assert row["currency"] == "USD"


class TestRobustBaseline:
    def test_sans_prix(self):
        assert robust_baseline([]) == (None, 0)

    def test_prix_nuls_ou_negatifs_ecartes(self):
        """0 € n'est pas un prix mais une lecture ratée ; il n'a pas de logarithme."""
        assert robust_baseline([0.0, -1.0]) == (None, 0)
        assert robust_baseline([0.0, 20.0, 20.0]) == (20.0, 2)

    def test_prix_constant_mad_nulle(self):
        """MAD = 0 : sans plancher de bande, tout écart d'un centime serait exclu."""
        assert robust_baseline([10.0] * 5) == (10.0, 5)
        # 2 % d'écart : sous le plancher de ±5 %, conservé.
        baseline, kept = robust_baseline([10.0, 10.0, 10.0, 10.0, 10.2])
        assert kept == 5
        assert baseline == pytest.approx(10.04)

    def test_dispersion_normale_entierement_conservee(self):
        assert robust_baseline([10.0, 11.0, 12.0, 13.0, 14.0]) == (12.0, 5)

    def test_bruit_conserve_valeur_aberrante_exclue(self):
        baseline, kept = robust_baseline([100.0, 102.0, 98.0, 101.0, 99.0, 250.0])
        assert kept == 5
        assert baseline == pytest.approx(100.0)

    def test_erreurs_multiplicatives_symetriques(self):
        """×10 et ÷10 sont à la même distance de la médiane en échelle log."""
        assert robust_baseline([50.0] * 5 + [500.0]) == (50.0, 5)
        assert robust_baseline([50.0] * 5 + [5.0]) == (50.0, 5)


class TestUsualPriceRange:
    def test_sans_prix(self):
        assert usual_price_range([]) is None
        assert usual_price_range([0.0]) is None

    def test_prix_constant_plancher_de_5_pourcents(self):
        low, high = usual_price_range([10.0] * 5)
        assert low == pytest.approx(10.0 / 1.05)
        assert high == pytest.approx(10.5)

    def test_un_releve_aberrant_n_elargit_pas_la_fourchette(self):
        """La MAD ignore le 500 € : la fourchette reste serrée autour de 50 €."""
        low, high = usual_price_range([50.0] * 5 + [500.0])
        assert high == pytest.approx(52.5)
        assert low == pytest.approx(50.0 / 1.05)

    def test_calculee_sur_les_jours_anterieurs(self):
        history = [snapshot(D - timedelta(days=5 - i), 10.0) for i in range(5)]
        rows = extract_rows(doc(history + [snapshot(D, 8.0)]))

        assert rows[-1]["usual_low_30d"] == pytest.approx(10.0 / 1.05)
        assert rows[0]["usual_low_30d"] is None


class TestBuildFrame:
    def test_concatene_les_produits(self):
        frame = build_frame([
            doc([snapshot(D, 10.0)], url="u1"),
            doc([snapshot(D, 20.0), snapshot(D - timedelta(days=1), 15.0)], url="u2"),
        ])
        assert len(frame) == 3
        assert set(frame["url"]) == {"u1", "u2"}

    def test_frame_vide_sans_donnees(self):
        assert build_frame([]).empty
        assert build_frame([doc([])]).empty


class TestLatestRowsOnly:
    def test_garde_le_dernier_releve_de_chaque_produit(self):
        frame = build_frame([
            doc([snapshot(D - timedelta(days=1), 10.0), snapshot(D, 11.0)], url="u1"),
            doc([snapshot(D - timedelta(days=3), 50.0), snapshot(D - timedelta(days=2), 42.0)], url="u2"),
        ])
        latest = latest_rows_only(frame).set_index("url")
        assert len(latest) == 2
        assert latest.loc["u1", PRICE_COLUMN] == 11.0
        assert latest.loc["u2", PRICE_COLUMN] == 42.0

    def test_frame_vide_traversee_sans_erreur(self):
        assert latest_rows_only(pd.DataFrame()).empty

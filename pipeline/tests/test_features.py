"""Extraction des séries temporelles par produit.

La règle que ces tests protègent : `mean_price_30d` et `n_observations` ne
regardent *que* les jours antérieurs. Si le prix du jour entrait dans sa propre
moyenne, un produit soldé une seule fois se comparerait en partie à lui-même et
son score serait mécaniquement amorti.
"""
from datetime import datetime, timedelta

import pandas as pd

from src.scoring.features import PRICE_COLUMN, build_frame, extract_rows, latest_rows_only
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
        assert row["mean_price_30d"] is None
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
        assert rows[-1]["mean_price_30d"] == 15.0
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
        assert rows[-1]["mean_price_30d"] == 200.0
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
        assert rows[-1]["mean_price_30d"] == 10.0

    def test_conserve_la_devise(self):
        [row] = extract_rows(doc([snapshot(D, 10.0, currency="USD")]))
        assert row["currency"] == "USD"


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

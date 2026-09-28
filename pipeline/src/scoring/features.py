"""Per-product price history rows, used to compare a product's current
price against its own past prices (never against other products).

Each row corresponds to one (url, day) price observation. `baseline_price_30d`,
`n_inliers` and `n_observations` are computed strictly from *prior* days of
that same product's history, so they never include the day's own price.

Prix de référence robuste (`baseline_price_30d`)
------------------------------------------------
Une moyenne simple se laisse déplacer par un seul relevé extrême : un prix lu
à 500 € au lieu de 50 € (autre variante, séparateur de milliers mal lu) fait
passer le produit pour une affaire à -60 % pendant 30 jours ; une promo passée
fait baisser la référence et rend invisibles les bonnes affaires suivantes.

On applique donc un **filtre de Hampel** aux prix de la fenêtre avant d'en
faire la moyenne :

1. on passe les prix en logarithme — les erreurs de prix sont
   multiplicatives (×10, ÷10), et le log les rend symétriques ;
2. on calcule la médiane `m` et la MAD (médiane des écarts absolus à `m`),
   l'équivalent robuste de l'écart-type (×1,4826 pour l'estimer sous
   hypothèse normale) ;
3. on écarte tout relevé à plus de `HAMPEL_K` écarts-types robustes de `m`,
   la bande ne descendant jamais sous ±`MIN_BAND_PCT` % : un prix Amazon
   évolue par paliers, la MAD y vaut souvent 0, et sans ce plancher le
   moindre centime d'écart serait jugé aberrant ;
4. le prix de référence est la moyenne des relevés conservés.

Le filtre ne touche **que la référence**, jamais le prix du jour : une vraie
bonne affaire est précisément une valeur extrême, c'est elle qu'on cherche.
Il ne touche pas non plus `price_history` : le graphique de la fiche produit
montre ce qui a réellement été relevé.
"""
import math
from typing import Any

import numpy as np
import pandas as pd

PRICE_COLUMN = "price_amount"

HAMPEL_K = 3.0
# Facteur de cohérence : MAD × 1,4826 estime l'écart-type d'une loi normale.
MAD_TO_SIGMA = 1.4826
MIN_BAND_PCT = 5.0
_MIN_BAND = math.log(1 + MIN_BAND_PCT / 100)


def _amount(value: dict[str, Any] | None) -> float | None:
    return value["amount"] if value else None


def robust_baseline(prices: list[float]) -> tuple[float | None, int]:
    """Moyenne des prix après exclusion des valeurs aberrantes (Hampel, en log).

    Renvoie `(prix de référence, nombre de relevés conservés)`, ou `(None, 0)`
    sans prix exploitable. Un prix nul ou négatif n'a pas de logarithme et
    n'est pas un prix : il est écarté d'office.
    """
    values = np.asarray([p for p in prices if p > 0], dtype=float)
    if values.size == 0:
        return None, 0

    logs = np.log(values)
    median = np.median(logs)
    deviations = np.abs(logs - median)
    band = max(HAMPEL_K * MAD_TO_SIGMA * float(np.median(deviations)), _MIN_BAND)

    # La médiane est toujours dans la bande : `kept` n'est jamais vide.
    kept = values[deviations <= band]
    return float(kept.mean()), int(kept.size)


def extract_rows(doc: dict[str, Any]) -> list[dict[str, Any]]:
    history = sorted(doc.get("history", []), key=lambda h: h["day"])
    if not history:
        return []

    prior: list[tuple[Any, float | None]] = []
    rows = []

    for snapshot in history:
        day = snapshot["day"]
        price = snapshot.get("price")
        price_amount = _amount(price)

        prior_30d = [amt for d, amt in prior if amt is not None and (day - d).days <= 30]

        if price_amount is not None:
            baseline, n_inliers = robust_baseline(prior_30d)
            rows.append(
                {
                    "url": doc["_id"],
                    "day": day,
                    "baseline_price_30d": baseline,
                    "n_inliers": n_inliers,
                    "n_observations": len(prior),
                    "currency": price["currency"],
                    PRICE_COLUMN: price_amount,
                }
            )

        prior.append((day, price_amount))

    return rows


def build_frame(docs: list[dict[str, Any]]) -> pd.DataFrame:
    rows = [row for doc in docs for row in extract_rows(doc)]
    return pd.DataFrame(rows)


def latest_rows_only(frame: pd.DataFrame) -> pd.DataFrame:
    """Keeps, for each url, only the most recent observation row."""
    if frame.empty:
        return frame
    return frame.sort_values("day").groupby("url", as_index=False).tail(1)

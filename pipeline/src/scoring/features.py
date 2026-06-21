"""Per-product price history rows, used to compare a product's current
price against its own past prices (never against other products).

Each row corresponds to one (url, day) price observation. `mean_price_30d`
and `n_observations` are computed strictly from *prior* days of that same
product's history, so they never include the day's own price.
"""
from typing import Any

import pandas as pd

PRICE_COLUMN = "price_amount"


def _amount(value: dict[str, Any] | None) -> float | None:
    return value["amount"] if value else None


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
            rows.append(
                {
                    "url": doc["_id"],
                    "day": day,
                    "mean_price_30d": sum(prior_30d) / len(prior_30d) if prior_30d else None,
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

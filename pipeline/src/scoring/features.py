"""Feature engineering for the price-prediction model.

Each row corresponds to one (url, day) price observation. Every feature is
computed strictly from *prior* days of that product's history, so the model
never sees the day's own price as an input — it has to predict it from
context (category, discount info, and how the price has moved before).
"""
from typing import Any

import pandas as pd

FEATURE_COLUMNS = [
    "shop",
    "keyword",
    "unit_price_amount",
    "crossed_out_price_amount",
    "mean_price_7d",
    "mean_price_30d",
    "min_price_30d",
    "max_price_30d",
    "n_observations",
    "days_since_first_seen",
    "day_of_week",
]
TARGET_COLUMN = "price_amount"


def _amount(value: dict[str, Any] | None) -> float | None:
    return value["amount"] if value else None


def extract_rows(doc: dict[str, Any]) -> list[dict[str, Any]]:
    history = sorted(doc.get("history", []), key=lambda h: h["day"])
    if not history:
        return []

    first_day = history[0]["day"]
    prior: list[tuple[Any, float | None]] = []
    rows = []

    for snapshot in history:
        day = snapshot["day"]
        price = snapshot.get("price")
        price_amount = _amount(price)

        prior_7d = [amt for d, amt in prior if amt is not None and (day - d).days <= 7]
        prior_30d = [amt for d, amt in prior if amt is not None and (day - d).days <= 30]

        if price_amount is not None:
            unit_price = snapshot.get("unitPrice")
            rows.append(
                {
                    "url": doc["_id"],
                    "day": day,
                    "shop": doc.get("shop") or "unknown",
                    "keyword": doc.get("keyword") or "unknown",
                    "unit_price_amount": unit_price["amount"] if unit_price else None,
                    "crossed_out_price_amount": _amount(snapshot.get("crossedOutPrice")),
                    "mean_price_7d": sum(prior_7d) / len(prior_7d) if prior_7d else None,
                    "mean_price_30d": sum(prior_30d) / len(prior_30d) if prior_30d else None,
                    "min_price_30d": min(prior_30d) if prior_30d else None,
                    "max_price_30d": max(prior_30d) if prior_30d else None,
                    "n_observations": len(prior),
                    "days_since_first_seen": (day - first_day).days,
                    "day_of_week": day.weekday(),
                    "currency": price["currency"],
                    TARGET_COLUMN: price_amount,
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

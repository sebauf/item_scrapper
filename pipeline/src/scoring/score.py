"""Scores the latest price of every product against its own price history
(never against other products): how far below (or above) its own usual
price over the last 30 days it currently is, plus whether its price is
trending up or down over its own history.

score = (predictedPrice - actualPrice) / predictedPrice * 100
A positive score means the actual price is below the product's own recent
usual price — i.e. a good deal relative to itself.

predictedPrice is the mean of the prior 30 days' prices *after* a Hampel
filter has discarded the outliers (see `features.robust_baseline`): a
single misread price or a past flash sale no longer drags the reference.

The score requires at least MIN_OBSERVATIONS prior prices *kept by that
filter* inside the 30-day window: the reference is only as reliable as the
points it rests on, and five readings of which two are aberrant are not
five usable readings. Products below that are skipped rather than given an
unreliable value.

trendDirection is the Theil–Sen slope (median of pairwise slopes) of the
product's whole priced history, relative to its median price: like the
reference price, it must not be swung by one misread reading.

A product is also skipped if its latest priced observation is older than
STALE_AFTER_DAYS: when a product goes unavailable, the scrapper stops
recording a price for it, so "latest priced row" silently falls back to
whatever price was last seen — without this check, a since-unavailable
product would keep showing its last (possibly days-old) price as today's
deal.

A product the scrapper has explicitly flagged `unavailable` (its product
page redirected away on the last visit) is skipped outright, regardless of
how recent its last price is: that flag is a stronger, direct signal than
staleness-by-age, and would otherwise keep resurfacing as a deal for up to
STALE_AFTER_DAYS after being confirmed gone. Its price_history is left
untouched — the product may come back into stock, at which point the
scrapper clears the flag on its next successful scrape.
"""
from datetime import datetime, timedelta, timezone

import numpy as np
from pymongo import UpdateOne
from pymongo.database import Database

from src.scoring.features import PRICE_COLUMN, build_frame, latest_rows_only

MIN_OBSERVATIONS = 5
TREND_THRESHOLD_PCT_PER_DAY = 0.5
STALE_AFTER_DAYS = 2


def theil_sen_slope(days: np.ndarray, prices: np.ndarray) -> float | None:
    """Pente de Theil–Sen : médiane des pentes entre toutes les paires de relevés.

    Une régression par moindres carrés minimise la somme des carrés des
    écarts : un seul relevé extrême (prix mal lu à ×10) pèse au carré et peut
    à lui seul inverser la tendance. La médiane des pentes, elle, tolère
    jusqu'à ~29 % de points aberrants sans bouger.

    Conséquence voulue : un saut isolé sur le dernier relevé ne fait pas une
    tendance. Le score mesure déjà l'écart du jour ; la tendance décrit la
    trajectoire. Renvoie None s'il n'y a aucune paire de jours distincts.
    """
    i, j = np.triu_indices(len(days), k=1)
    dx = days[j] - days[i]
    distinct = dx != 0
    if not distinct.any():
        return None
    return float(np.median((prices[j] - prices[i])[distinct] / dx[distinct]))


def _trend_direction(frame, url: str) -> str:
    history = frame[frame["url"] == url].sort_values("day")
    days = np.array([(d - history["day"].iloc[0]).days for d in history["day"]], dtype=float)
    prices = history[PRICE_COLUMN].to_numpy(dtype=float)

    # Médiane plutôt que moyenne, pour la même raison que la pente.
    reference_price = float(np.median(prices))
    slope = theil_sen_slope(days, prices)
    if reference_price <= 0 or slope is None:
        return "stable"

    relative_slope_pct_per_day = slope / reference_price * 100

    if relative_slope_pct_per_day <= -TREND_THRESHOLD_PCT_PER_DAY:
        return "down"
    if relative_slope_pct_per_day >= TREND_THRESHOLD_PCT_PER_DAY:
        return "up"
    return "stable"


def score(db: Database) -> int:
    docs = list(db["price_history"].find({"unavailable": {"$ne": True}}))
    frame = build_frame(docs)

    now = datetime.now(timezone.utc)
    stale_cutoff = now.replace(tzinfo=None) - timedelta(days=STALE_AFTER_DAYS)

    scoreable = frame.iloc[0:0]
    if not frame.empty:
        latest = latest_rows_only(frame)
        scoreable = latest[
            (latest["n_inliers"] >= MIN_OBSERVATIONS)
            & latest["baseline_price_30d"].notna()
            & (latest["day"] >= stale_cutoff)
        ]

    operations = []
    for row in scoreable.to_dict("records"):
        url = row["url"]
        predicted_price = row["baseline_price_30d"]
        actual_price = row[PRICE_COLUMN]
        deal_score = (predicted_price - actual_price) / predicted_price * 100

        operations.append(
            UpdateOne(
                {"_id": url},
                {
                    "$set": {
                        "score": round(float(deal_score), 1),
                        "predictedPrice": round(float(predicted_price), 2),
                        "actualPrice": actual_price,
                        "currency": row["currency"],
                        "trendDirection": _trend_direction(frame, url),
                        "computedAt": now,
                    }
                },
                upsert=True,
            )
        )

    if operations:
        db["deal_scores"].bulk_write(operations)

    # Drop any leftover deal_scores from products that no longer meet the
    # threshold (or from the old cross-product ML model) so the frontend
    # never shows a stale/unreliable score.
    scored_urls = scoreable["url"].tolist() if not scoreable.empty else []
    db["deal_scores"].delete_many({"_id": {"$nin": scored_urls}})

    return len(operations)


if __name__ == "__main__":
    from pymongo import MongoClient

    from src.config import DB_NAME, MONGODB_URI

    client = MongoClient(MONGODB_URI)
    count = score(client[DB_NAME])
    print(f"deal_scores: {count} products scored")

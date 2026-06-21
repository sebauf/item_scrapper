"""Scores the latest price of every product against its own price history
(never against other products): how far below (or above) its own rolling
30-day average it currently is, plus whether its price is trending up or
down over its own history.

score = (predictedPrice - actualPrice) / predictedPrice * 100
A positive score means the actual price is below the product's own recent
average — i.e. a good deal relative to itself.

Both the score and the trend require at least MIN_OBSERVATIONS prior
observations; products scraped too few times are skipped rather than given
an unreliable value.
"""
from datetime import datetime, timezone

import numpy as np
from pymongo import UpdateOne
from pymongo.database import Database

from src.scoring.features import PRICE_COLUMN, build_frame, latest_rows_only

MIN_OBSERVATIONS = 5
TREND_THRESHOLD_PCT_PER_DAY = 0.5


def _trend_direction(frame, url: str) -> str:
    history = frame[frame["url"] == url].sort_values("day")
    days = np.array([(d - history["day"].iloc[0]).days for d in history["day"]], dtype=float)
    prices = history[PRICE_COLUMN].to_numpy(dtype=float)

    mean_price = prices.mean()
    if mean_price == 0:
        return "stable"

    slope = np.polyfit(days, prices, 1)[0]
    relative_slope_pct_per_day = slope / mean_price * 100

    if relative_slope_pct_per_day <= -TREND_THRESHOLD_PCT_PER_DAY:
        return "down"
    if relative_slope_pct_per_day >= TREND_THRESHOLD_PCT_PER_DAY:
        return "up"
    return "stable"


def score(db: Database) -> int:
    docs = list(db["price_history"].find({}))
    frame = build_frame(docs)

    scoreable = frame.iloc[0:0]
    if not frame.empty:
        latest = latest_rows_only(frame)
        scoreable = latest[(latest["n_observations"] >= MIN_OBSERVATIONS) & latest["mean_price_30d"].notna()]

    now = datetime.now(timezone.utc)
    operations = []
    for row in scoreable.to_dict("records"):
        url = row["url"]
        predicted_price = row["mean_price_30d"]
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

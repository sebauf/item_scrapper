"""Scores the latest price of every product: how far below (or above) its
model-predicted 'expected' price it currently is.

score = (predictedPrice - actualPrice) / predictedPrice * 100
A positive score means the actual price is below what the model expected
given the product's context and history — i.e. a good deal.
"""
import os
from datetime import datetime, timezone

import joblib
from pymongo import UpdateOne
from pymongo.database import Database

from src.scoring.features import FEATURE_COLUMNS, TARGET_COLUMN, build_frame, latest_rows_only


def score(db: Database, model_path) -> int:
    if not model_path.exists():
        print(f"No trained model at {model_path}. Skipping scoring.")
        return 0

    pipeline = joblib.load(model_path)
    model_version = str(int(os.path.getmtime(model_path)))

    docs = list(db["price_history"].find({}))
    frame = build_frame(docs)
    latest = latest_rows_only(frame)

    if latest.empty:
        print("No scoreable products found.")
        return 0

    predicted = pipeline.predict(latest[FEATURE_COLUMNS])
    now = datetime.now(timezone.utc)

    operations = []
    for row, predicted_price in zip(latest.to_dict("records"), predicted):
        actual_price = row[TARGET_COLUMN]
        deal_score = (predicted_price - actual_price) / predicted_price * 100

        operations.append(
            UpdateOne(
                {"_id": row["url"]},
                {
                    "$set": {
                        "score": round(float(deal_score), 1),
                        "predictedPrice": round(float(predicted_price), 2),
                        "actualPrice": actual_price,
                        "currency": row["currency"],
                        "modelVersion": model_version,
                        "computedAt": now,
                    }
                },
                upsert=True,
            )
        )

    db["deal_scores"].bulk_write(operations)
    return len(operations)


if __name__ == "__main__":
    from pymongo import MongoClient

    from src.config import DB_NAME, MODEL_PATH, MONGODB_URI

    client = MongoClient(MONGODB_URI)
    count = score(client[DB_NAME], MODEL_PATH)
    print(f"deal_scores: {count} products scored")

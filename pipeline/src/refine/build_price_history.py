"""Builds the `price_history` collection (one document per product URL,
with a time series of daily price snapshots) from the raw `items_raw`
collection written by the scrapper.

Idempotent: safe to re-run after every scrape, replaces each product's
document with the freshly recomputed history.
"""
from datetime import datetime, timezone

from pymongo import UpdateOne
from pymongo.database import Database

PIPELINE = [
    {"$sort": {"url": 1, "day": 1}},
    {
        "$group": {
            "_id": "$url",
            "shop": {"$last": "$shop"},
            "keyword": {"$last": "$keyword"},
            "title": {"$last": "$title"},
            "images": {"$last": "$images"},
            "firstSeen": {"$min": "$day"},
            "lastSeen": {"$max": "$day"},
            "history": {
                "$push": {
                    "day": "$day",
                    "price": "$price",
                    "crossedOutPrice": "$crossedOutPrice",
                    "unitPrice": "$unitPrice",
                    "scrapedAt": "$scrapedAt",
                }
            },
        }
    },
]


def build_price_history(db: Database) -> int:
    """Returns the number of products written to `price_history`."""
    now = datetime.now(timezone.utc)
    operations = []

    for doc in db["items_raw"].aggregate(PIPELINE):
        url = doc.pop("_id")
        doc["updatedAt"] = now
        operations.append(UpdateOne({"_id": url}, {"$set": doc}, upsert=True))

    if not operations:
        return 0

    db["price_history"].bulk_write(operations)
    return len(operations)


if __name__ == "__main__":
    from pymongo import MongoClient

    from src.config import DB_NAME, MONGODB_URI

    client = MongoClient(MONGODB_URI)
    count = build_price_history(client[DB_NAME])
    print(f"price_history: {count} products refreshed")

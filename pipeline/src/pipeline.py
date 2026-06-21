"""Orchestrates the full pipeline: refine raw scrapes into price history,
retrain the deal-scoring model, then score every product's current price.

Run manually after a scrapper run:

    cd pipeline
    python -m src.pipeline
"""
from pymongo import MongoClient

from src.config import DB_NAME, MODEL_PATH, MONGODB_URI
from src.refine.build_price_history import build_price_history
from src.scoring.score import score
from src.scoring.train import train


def run() -> None:
    client = MongoClient(MONGODB_URI)
    db = client[DB_NAME]

    refined = build_price_history(db)
    print(f"price_history: {refined} products refreshed")

    train(db, MODEL_PATH)
    scored = score(db, MODEL_PATH)
    print(f"deal_scores: {scored} products scored")


if __name__ == "__main__":
    run()

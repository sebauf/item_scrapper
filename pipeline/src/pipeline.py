"""Orchestrates the full pipeline: purge the products the scrapper can no
longer read, refine raw scrapes into price history, then score every product's
current price against its own history.

Run manually after a scrapper run:

    cd pipeline
    python -m src.pipeline
"""
from src.database import open_database
from src.maintenance.purge_dead_products import purge_dead_products
from src.refine.build_price_history import build_price_history
from src.scoring.score import score


def run() -> None:
    with open_database() as db:
        # Avant le refine, et pas après : `build_price_history` reconstruit
        # `price_history` depuis `items_raw`, donc purger ensuite laisserait le
        # pipeline ressusciter le document qu'on vient de supprimer.
        purged = purge_dead_products(db)
        print(f"purge: {purged} dead products removed")

        refined = build_price_history(db)
        print(f"price_history: {refined} products refreshed")

        scored = score(db)
        print(f"deal_scores: {scored} products scored")


if __name__ == "__main__":
    run()

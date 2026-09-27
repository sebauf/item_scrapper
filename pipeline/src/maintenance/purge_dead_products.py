"""Supprime définitivement les produits que le scrapper n'arrive plus à relever.

Un produit dont aucun relevé **exploitable** (titre et prix présents) n'a été
enregistré depuis plus de PURGE_AFTER_DAYS jours est considéré comme mort :
retiré de la vente, page supprimée, ou bloqué depuis si longtemps qu'on ne sait
plus rien en dire. Ses documents partent d'`items_raw`, de `price_history` et
de `deal_scores`.

Deux raisons de supprimer plutôt que de masquer :

- **le budget de crawl.** Le scrapper relit les produits connus depuis
  `price_history` ; tant que le document existe, il consomme une requête par
  exécution pour reconfirmer une page morte. C'est ce budget qui manque aux
  produits vivants.
- **l'affichage.** Les écrans masquent déjà ce que le dernier passage n'a pas
  rafraîchi (cf. backend/src/shared/infrastructure/mongo/last-scrape.ts) ; un
  produit mort n'est donc plus visible bien avant d'être purgé. La purge ne
  change pas ce qu'on voit, elle arrête d'en payer le coût.

La fenêtre se compte depuis le **dernier passage du scrapper**, pas depuis
maintenant : si le scrapper tombe en panne trois semaines, la purge ne doit pas
vider le catalogue au premier redémarrage du pipeline. C'est le même point
d'ancrage que le filtre de fraîcheur du backend.

Ce qui échappe à la purge : les URLs suivies à l'unité (`tracked_urls`) et les
favoris (`favorites`). Ce sont des demandes explicites de l'utilisateur —
effacer l'historique de prix qu'il a demandé à constituer, parce que la boutique
a retiré la fiche quinze jours, serait une perte sèche et irréversible.
"""
from datetime import timedelta

from pymongo.database import Database

PURGE_AFTER_DAYS = 15


def _last_scrape_day(db: Database):
    """Jour du dernier passage du scrapper, ou None sur une base vide."""
    doc = db["items_raw"].find_one({}, sort=[("day", -1)], projection={"day": 1})
    return doc.get("day") if doc else None


def _protected_urls(db: Database) -> set:
    return {doc["url"] for doc in db["tracked_urls"].find({}, {"url": 1})} | {
        doc["url"] for doc in db["favorites"].find({}, {"url": 1})
    }


def _day_by_url(db: Database, match: dict, accumulator: str) -> dict:
    rows = db["items_raw"].aggregate(
        [{"$match": match}, {"$group": {"_id": "$url", "day": {accumulator: "$day"}}}]
    )
    return {row["_id"]: row["day"] for row in rows}


def purge_dead_products(db: Database) -> int:
    """Returns the number of products deleted."""
    last_scrape_day = _last_scrape_day(db)
    if last_scrape_day is None:
        return 0

    cutoff = last_scrape_day - timedelta(days=PURGE_AFTER_DAYS)
    last_usable = _day_by_url(db, {"title": {"$ne": ""}, "price": {"$ne": None}}, "$max")
    first_seen = _day_by_url(db, {}, "$min")
    protected = _protected_urls(db)

    # `first_seen` en repli : un produit qui n'a jamais publié de prix
    # exploitable n'a pas de « dernier relevé utile », c'est donc son ancienneté
    # qui le condamne. Sans ce repli il survivrait indéfiniment ; avec lui, un
    # produit ajouté hier et encore sans prix garde ses quinze jours.
    dead = [
        url
        for url, first_day in first_seen.items()
        if url not in protected and last_usable.get(url, first_day) < cutoff
    ]
    if not dead:
        return 0

    db["items_raw"].delete_many({"url": {"$in": dead}})
    db["price_history"].delete_many({"_id": {"$in": dead}})
    db["deal_scores"].delete_many({"_id": {"$in": dead}})

    return len(dead)


if __name__ == "__main__":
    from pymongo import MongoClient

    from src.config import DB_NAME, MONGODB_URI

    client = MongoClient(MONGODB_URI)
    count = purge_dead_products(client[DB_NAME])
    print(f"purge: {count} dead products removed")

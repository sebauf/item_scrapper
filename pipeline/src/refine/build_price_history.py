"""Builds the `price_history` collection (one document per product URL,
with a time series of daily price snapshots) from the raw `items_raw`
collection written by the scrapper.

Idempotent: safe to re-run after every scrape, replaces each product's
document with the freshly recomputed history.
"""
from datetime import datetime, timezone

from pymongo import UpdateOne
from pymongo.database import Database

# Champs d'identité de l'article (code-barres, marque, contenance), par
# opposition aux champs volatils que sont le prix ou la date de livraison.
#
# Ils sont traités à part parce qu'ils se comportent autrement dans le temps :
# un titre ou une photo changent légitimement, et le relevé le plus récent
# fait alors autorité. Un code-barres, lui, ne change pas — s'il manque au
# dernier relevé, c'est que la page était dégradée (blocage, section
# « Informations sur le produit » non rendue), pas que l'article en a changé.
#
# D'où la règle retenue : **dernière valeur non nulle** plutôt que dernière
# valeur. Un seul scrape dégradé effacerait sinon l'identité d'un produit, et
# avec elle sa seule clé de rapprochement inter-enseignes.
IDENTITY_FIELDS = ("ean", "brand", "mpn", "quantity", "packSize", "doses")

_CANDIDATES_SUFFIX = "__candidates"


def _group_stage() -> dict:
    group = {
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
    # Le $sort amont garantit l'ordre chronologique de ces tableaux.
    for field in IDENTITY_FIELDS:
        group[f"{field}{_CANDIDATES_SUFFIX}"] = {"$push": f"${field}"}
    return {"$group": group}


def _last_known_stage() -> dict:
    """Réduit chaque tableau de candidats à sa dernière valeur renseignée."""
    return {
        "$set": {
            field: {
                "$ifNull": [
                    {
                        "$arrayElemAt": [
                            {
                                "$filter": {
                                    "input": f"${field}{_CANDIDATES_SUFFIX}",
                                    "cond": {"$ne": ["$$this", None]},
                                }
                            },
                            -1,
                        ]
                    },
                    None,
                ]
            }
            for field in IDENTITY_FIELDS
        }
    }


PIPELINE = [
    {"$sort": {"url": 1, "day": 1}},
    _group_stage(),
    _last_known_stage(),
    # Projection d'exclusion plutôt que $unset : même effet, et c'est la
    # forme que sait exécuter mongomock, sur lequel tournent les tests.
    {"$project": {f"{field}{_CANDIDATES_SUFFIX}": 0 for field in IDENTITY_FIELDS}},
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

"""Rapport de couverture d'identité — combien d'offres pourront être comparées
**strictement** à celles d'une autre enseigne.

Lecture seule : ne lit que `price_history`, n'écrit rien, n'envoie aucune
requête aux boutiques. Il mesure ce que le scrape nocturne a *déjà* relevé.

Le chiffre décisif est la part d'offres portant la clé stricte
**(EAN, nombre d'unités)**. L'EAN seul ne suffit pas : il désigne l'unité
fabriquée (la bouteille), et un lot constitué par le vendeur reprend le plus
souvent cet EAN. Une bouteille et un lot de deux auraient alors la même clé,
et la comparaison afficherait « deux fois plus cher » une offre qui contient
deux fois plus.

Le rapport se lit avec la grille de `docs/spike-jsonld-amazon.md` §5,
appliquée à cette clé stricte :

- ≥ 60 % : le rapprochement est essentiellement résolu ;
- 25 – 60 % : cascade complète (EAN + lot, puis attributs validés à la main) ;
- < 25 % : l'identité doit venir du concurrent, ou la comparaison stricte est
  à abandonner sur ces catégories — jamais en abaissant les seuils.

Usage :
    python -m src.reports.identity_coverage                # Amazon, catalogue frais
    python -m src.reports.identity_coverage --all          # y compris non relus
    python -m src.reports.identity_coverage --json         # sortie machine
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from dataclasses import asdict, dataclass, field

from pymongo.database import Database

FIELDS = (
    "keyword",
    "title",
    "lastSeen",
    "ean",
    "brand",
    "mpn",
    "packSize",
    "quantity",
    "unitQuantity",
    "doses",
    "unitDoses",
)

STRICT_RESOLVED = 60.0
STRICT_PARTIAL = 25.0
MAX_EXAMPLES = 5
TRACKED_URL_LABEL = "(URL suivie)"


def load_offers(db: Database, shop: str = "amazon", fresh_only: bool = True) -> list[dict]:
    """Offres de `shop` encore en vente.

    `fresh_only` applique la règle de fraîcheur des écrans : seules comptent
    les offres relues au dernier passage du scrapper pour cette boutique. Une
    fiche que le dernier passage n'a pas revue n'est pas visible dans
    l'application ; la compter fausserait la mesure de ce qui sera comparable.
    """
    match: dict = {"shop": shop, "unavailable": {"$ne": True}}
    projection = {name: 1 for name in FIELDS}
    collection = db["price_history"]

    if fresh_only:
        latest = collection.find_one(match, sort=[("lastSeen", -1)], projection={"lastSeen": 1})
        if latest is None or latest.get("lastSeen") is None:
            return []
        match = {**match, "lastSeen": latest["lastSeen"]}

    return list(collection.find(match, projection))


def _has(offer: dict, name: str) -> bool:
    return offer.get(name) is not None


def _has_unit_measure(offer: dict) -> bool:
    return _has(offer, "unitQuantity") or _has(offer, "unitDoses")


def _strict(offer: dict) -> bool:
    return _has(offer, "ean") and _has(offer, "packSize")


def _by_attributes(offer: dict) -> bool:
    """Rapprochable sans EAN, mais seulement après validation humaine."""
    return (
        not _has(offer, "ean")
        and _has(offer, "brand")
        and _has(offer, "packSize")
        and _has_unit_measure(offer)
    )


def _pct(count: int, total: int) -> float:
    return round(count / total * 100, 1) if total else 0.0


@dataclass
class KeywordCoverage:
    keyword: str
    offers: int
    ean_pct: float
    strict_pct: float


@dataclass
class SharedEanExample:
    ean: str
    offers: list[dict]


@dataclass
class CoverageSummary:
    offers: int
    counts: dict[str, int]
    rates: dict[str, float]
    verdict: str
    by_keyword: list[KeywordCoverage] = field(default_factory=list)
    shared_ean_groups: dict[str, int] = field(default_factory=dict)
    shared_ean_examples: list[SharedEanExample] = field(default_factory=list)


def _verdict(strict_pct: float, total: int) -> str:
    if total == 0:
        return "aucune offre — rien à mesurer"
    if strict_pct >= STRICT_RESOLVED:
        return "résolu : comparaison stricte sur EAN + lot pour l'essentiel du catalogue"
    if strict_pct >= STRICT_PARTIAL:
        return "partiel : cascade complète nécessaire (EAN + lot, puis attributs validés)"
    return "insuffisant : l'identité devra venir du concurrent, ne pas abaisser les seuils"


def _shared_ean_groups(offers: list[dict]) -> tuple[dict[str, int], list[SharedEanExample]]:
    """Plusieurs offres de la même boutique sous un même EAN.

    C'est la preuve directe, chez une seule enseigne, du piège des lots : si
    deux fiches Amazon portent le même EAN avec des nombres d'unités
    différents, une comparaison sur l'EAN seul se tromperait déjà ici.
    """
    by_ean: dict[str, list[dict]] = defaultdict(list)
    for offer in offers:
        if _has(offer, "ean"):
            by_ean[offer["ean"]].append(offer)

    groups = {"total": 0, "lots_differents": 0, "lot_inconnu": 0, "meme_lot": 0}
    examples: list[SharedEanExample] = []
    for ean, members in sorted(by_ean.items()):
        if len(members) < 2:
            continue
        groups["total"] += 1
        packs = [member.get("packSize") for member in members]
        if None in packs:
            groups["lot_inconnu"] += 1
        elif len(set(packs)) > 1:
            groups["lots_differents"] += 1
            if len(examples) < MAX_EXAMPLES:
                examples.append(
                    SharedEanExample(
                        ean=ean,
                        offers=[
                            {
                                "url": member["_id"],
                                "title": member.get("title"),
                                "packSize": member.get("packSize"),
                            }
                            for member in members
                        ],
                    )
                )
        else:
            groups["meme_lot"] += 1
    return groups, examples


def summarize(offers: list[dict]) -> CoverageSummary:
    total = len(offers)
    count = lambda predicate: sum(1 for offer in offers if predicate(offer))  # noqa: E731

    counts = {
        "ean": count(lambda o: _has(o, "ean")),
        "brand": count(lambda o: _has(o, "brand")),
        "mpn": count(lambda o: _has(o, "mpn")),
        "packSize": count(lambda o: _has(o, "packSize")),
        "packSize_1": count(lambda o: o.get("packSize") == 1),
        "packSize_lot": count(lambda o: (o.get("packSize") or 0) > 1),
        "unitQuantity": count(lambda o: _has(o, "unitQuantity")),
        "unitDoses": count(lambda o: _has(o, "unitDoses")),
        "strict": count(_strict),
        "ean_without_pack": count(lambda o: _has(o, "ean") and not _has(o, "packSize")),
        "by_attributes": count(_by_attributes),
    }
    counts["not_comparable"] = total - counts["strict"] - counts["by_attributes"]
    rates = {name: _pct(value, total) for name, value in counts.items()}

    per_keyword: dict[str, list[dict]] = defaultdict(list)
    for offer in offers:
        per_keyword[offer.get("keyword") or TRACKED_URL_LABEL].append(offer)
    by_keyword = [
        KeywordCoverage(
            keyword=keyword,
            offers=len(members),
            ean_pct=_pct(sum(1 for m in members if _has(m, "ean")), len(members)),
            strict_pct=_pct(sum(1 for m in members if _strict(m)), len(members)),
        )
        for keyword, members in sorted(per_keyword.items(), key=lambda item: -len(item[1]))
    ]

    groups, examples = _shared_ean_groups(offers)
    return CoverageSummary(
        offers=total,
        counts=counts,
        rates=rates,
        verdict=_verdict(rates["strict"], total),
        by_keyword=by_keyword,
        shared_ean_groups=groups,
        shared_ean_examples=examples,
    )


def format_report(summary: CoverageSummary, shop: str, fresh_only: bool) -> str:
    n = summary.offers
    scope = "relues au dernier passage" if fresh_only else "toutes, relues ou non"
    lines = [f"=== Couverture d'identité — {shop}, offres en vente {scope} : {n} ===", ""]
    if n == 0:
        lines.append("Aucune offre : base vide, ou boutique inconnue.")
        return "\n".join(lines)

    def row(label: str, key: str) -> str:
        return f"{label:<52}{summary.counts[key]:>6}   {summary.rates[key]:>5.1f} %"

    lines += [
        row("EAN vérifié", "ean"),
        row("Marque", "brand"),
        row("Référence fabricant", "mpn"),
        row("Nombre d'unités établi", "packSize"),
        row("  dont vendu à l'unité (déclaré)", "packSize_1"),
        row("  dont lot (≥ 2 unités)", "packSize_lot"),
        row("Contenance d'une unité", "unitQuantity"),
        row("Doses d'une unité", "unitDoses"),
        "",
        row("① Clé stricte (EAN + nombre d'unités)", "strict"),
        row("   EAN mais lot non établi — perdu pour le strict", "ean_without_pack"),
        row("② Sans EAN : marque + lot + mesure unitaire", "by_attributes"),
        row("③ Non comparable", "not_comparable"),
        "",
        f"Verdict (clé stricte) : {summary.verdict}",
        "② = charge de validation humaine à prévoir ; jamais affiché sans elle.",
        "",
        "Par mot-clé :",
        f"  {'mot-clé':<34}{'offres':>7}{'EAN':>9}{'strict':>9}",
    ]
    for item in summary.by_keyword:
        lines.append(
            f"  {item.keyword[:34]:<34}{item.offers:>7}{item.ean_pct:>8.1f}%{item.strict_pct:>8.1f}%"
        )

    groups = summary.shared_ean_groups
    lines += [
        "",
        f"EAN portés par plusieurs offres de {shop} : {groups.get('total', 0)}",
        f"  même nombre d'unités        : {groups.get('meme_lot', 0)}",
        f"  nombres d'unités différents : {groups.get('lots_differents', 0)}"
        "   ← le piège de l'EAN seul, observé chez une seule enseigne",
        f"  au moins un lot inconnu     : {groups.get('lot_inconnu', 0)}",
    ]
    for example in summary.shared_ean_examples:
        lines.append(f"  EAN {example.ean}")
        for offer in example.offers:
            lines.append(f"    ×{offer['packSize']}  {(offer['title'] or '')[:70]}  {offer['url']}")

    if summary.rates["packSize"] == 0 and summary.rates["ean"] > 0:
        lines += [
            "",
            "⚠ Aucun nombre d'unités établi alors que des EAN existent : le scrapper",
            "  déployé est-il antérieur à la lecture de « Nombre d'articles » ? Attendre",
            "  deux ou trois scrapes et le refine suivant avant de conclure.",
        ]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--shop", default="amazon")
    parser.add_argument("--all", action="store_true", help="inclure les offres non relues au dernier passage")
    parser.add_argument("--json", action="store_true", help="sortie JSON")
    args = parser.parse_args()

    from pymongo import MongoClient

    from src.config import DB_NAME, MONGODB_URI

    client = MongoClient(MONGODB_URI)
    try:
        offers = load_offers(client[DB_NAME], shop=args.shop, fresh_only=not args.all)
    finally:
        client.close()

    summary = summarize(offers)
    if args.json:
        print(json.dumps(asdict(summary), ensure_ascii=False, indent=2))
    else:
        print(format_report(summary, shop=args.shop, fresh_only=not args.all))


if __name__ == "__main__":
    main()

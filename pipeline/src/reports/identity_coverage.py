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

Le rapport lit aussi, dans `items_raw`, les **traces d'extraction** du dernier
passage (`identityDiagnostics`) : d'où vient chaque EAN, combien de lignes de
caractéristiques ont été lues, si la page affichait « EAN » sans qu'on le
lise. Une couverture faible a deux causes aux remèdes opposés — l'enseigne ne
publie pas l'identité, ou le scrapper ne sait plus la lire — et seules ces
traces les distinguent. Quand la lecture est visiblement en panne, le rapport
**refuse de rendre un verdict** plutôt que d'en rendre un faux.

Usage :
    python -m src.reports.identity_coverage                # Amazon, catalogue frais
    python -m src.reports.identity_coverage --all          # y compris non relus
    python -m src.reports.identity_coverage --json         # sortie machine
"""
from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field

from pymongo.database import Database

from src.database import open_database

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

# En deçà de cette part de fiches dont les caractéristiques ont été lues, la
# couverture d'EAN mesure la panne du scrapper, pas ce que publie l'enseigne.
MIN_DETAILS_READ_PCT = 50.0
# Pas de jugement sur la lecture avec moins de fiches diagnostiquées.
MIN_DIAGNOSED_PAGES = 10
TOP_LABELS = 20

# Taux strict sous cette fraction du plus petit plafond (EAN ou lot) : le
# facteur limitant n'est plus une moitié de la clé mais leur croisement.
CROSSING_RATIO = 0.8

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


def limiting_factor(rates: dict[str, float]) -> str:
    """Laquelle des deux moitiés de la clé stricte bride la couverture.

    La clé exige l'EAN **et** le nombre d'unités : chacun plafonne le taux
    strict, et les deux plafonds appellent des remèdes opposés. Un EAN rare
    est une question d'identité (la chercher chez le concurrent) ; un lot
    rarement établi alors que l'EAN est là est une question de lecture du
    conditionnement — « Nombre d'articles », ou la clé (EAN, contenu total).
    """
    ean, pack = rates["ean"], rates["packSize"]
    if ean < STRICT_PARTIAL and pack < STRICT_PARTIAL:
        return f"EAN ({ean:.1f} %) et nombre d'unités ({pack:.1f} %) manquent tous deux"
    if ean < STRICT_PARTIAL:
        return f"l'EAN ({ean:.1f} % des offres) ; le nombre d'unités est établi pour {pack:.1f} %"
    # Chaque moitié plafonne le taux strict. S'il reste nettement sous les deux
    # plafonds, c'est que l'EAN et le lot tombent rarement sur les mêmes offres.
    if rates["strict"] < CROSSING_RATIO * min(ean, pack):
        return f"le croisement : EAN ({ean:.1f} %) et lot ({pack:.1f} %) rarement sur les mêmes offres"
    if pack <= ean:
        return (
            f"le nombre d'unités ({pack:.1f} %) ; {rates['ean_without_pack']:.1f} % des offres ont "
            "un EAN sans lot établi"
        )
    return f"l'EAN ({ean:.1f} % des offres) ; le nombre d'unités est établi pour {pack:.1f} %"


def _verdict(rates: dict[str, float], total: int) -> str:
    if total == 0:
        return "aucune offre — rien à mesurer"
    strict = rates["strict"]
    if strict >= STRICT_RESOLVED:
        return "résolu : comparaison stricte sur EAN + lot pour l'essentiel du catalogue"
    factor = limiting_factor(rates)
    if strict >= STRICT_PARTIAL:
        return (
            "partiel : cascade complète nécessaire (EAN + lot, puis attributs validés) — "
            f"facteur limitant : {factor}"
        )
    if rates["ean"] < STRICT_PARTIAL:
        # Seul cas où la conclusion historique tient : l'EAN lui-même manque.
        return (
            f"insuffisant, faute d'EAN — facteur limitant : {factor}. L'identité devra venir "
            "du concurrent ; ne pas abaisser les seuils"
        )
    return (
        f"insuffisant, mais pas faute d'identité — facteur limitant : {factor}. Corriger la "
        "lecture du lot (« Nombre d'articles ») ou adopter la clé (EAN, contenu total) ; "
        "ne pas abaisser les seuils"
    )


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
        verdict=_verdict(rates, total),
        by_keyword=by_keyword,
        shared_ean_groups=groups,
        shared_ean_examples=examples,
    )


def load_scrape_diagnostics(db: Database, shop: str = "amazon") -> list[dict]:
    """Traces d'extraction des relevés du dernier passage de `shop`."""
    collection = db["items_raw"]
    latest = collection.find_one({"shop": shop}, sort=[("day", -1)], projection={"day": 1})
    if latest is None or latest.get("day") is None:
        return []
    return list(
        collection.find({"shop": shop, "day": latest["day"]}, {"identityDiagnostics": 1})
    )


@dataclass
class ExtractionDiagnostics:
    pages: int
    diagnosed: int
    ean_sources: dict[str, int]
    details_read: int
    unread_but_ean_visible: int
    unread_no_known_container: int
    json_ld_product: int
    item_count_visible: int
    declared_pack: int
    pack_issues: dict[str, int]
    containers: dict[str, int]
    top_labels: list[tuple[str, int]]


def summarize_diagnostics(rows: list[dict]) -> ExtractionDiagnostics:
    traces = [row["identityDiagnostics"] for row in rows if row.get("identityDiagnostics")]
    unread = [t for t in traces if not t.get("detailEntries")]
    labels: Counter[str] = Counter()
    containers: Counter[str] = Counter()
    for trace in traces:
        labels.update(trace.get("detailLabels") or [])
        containers.update(trace.get("detailContainers") or [])

    sources = Counter(t.get("eanSource") or "aucune" for t in traces)
    issues = Counter(t["packIssue"] for t in traces if t.get("packIssue"))
    return ExtractionDiagnostics(
        pages=len(rows),
        diagnosed=len(traces),
        ean_sources={name: sources.get(name, 0) for name in ("details", "json-ld", "aucune")},
        details_read=len(traces) - len(unread),
        unread_but_ean_visible=sum(1 for t in unread if t.get("mentionsEan")),
        unread_no_known_container=sum(1 for t in unread if not t.get("detailContainers")),
        json_ld_product=sum(1 for t in traces if t.get("jsonLdProduct")),
        item_count_visible=sum(1 for t in traces if t.get("mentionsItemCount")),
        declared_pack=sum(1 for t in traces if t.get("declaredPackSize") is not None),
        pack_issues=dict(issues),
        containers=dict(containers.most_common()),
        top_labels=labels.most_common(TOP_LABELS),
    )


@dataclass
class Report:
    coverage: CoverageSummary
    diagnostics: ExtractionDiagnostics
    verdict: str
    conclusive: bool
    warnings: list[str]


def assess(coverage: CoverageSummary, diagnostics: ExtractionDiagnostics) -> Report:
    """Verdict final : celui de la grille, sauf si les données le rendent faux.

    Chaque avertissement nomme une cause et son remède. Les deux premiers
    rendent le verdict non concluant : ils disent que la mesure porte sur un
    défaut de collecte, pas sur l'enseigne.
    """
    warnings: list[str] = []
    conclusive = coverage.offers > 0

    if diagnostics.pages > 0 and diagnostics.diagnosed == 0:
        conclusive = False
        warnings.append(
            "Aucune trace d'extraction au dernier passage : le scrapper déployé est antérieur "
            "au diagnostic. Impossible de dire si une identité manquante est absente de la "
            "fiche ou non lue. Attendre un passage du scrapper à jour."
        )
    elif diagnostics.diagnosed >= MIN_DIAGNOSED_PAGES:
        read_pct = _pct(diagnostics.details_read, diagnostics.diagnosed)
        if read_pct < MIN_DETAILS_READ_PCT:
            conclusive = False
            warnings.append(
                f"Caractéristiques lues sur {read_pct:.1f} % des fiches seulement : la couverture "
                "d'EAN mesure la panne de lecture, pas ce qu'Amazon publie. "
                f"{diagnostics.unread_but_ean_visible} fiche(s) affichaient « EAN » sans qu'il soit "
                "lu (sélecteurs à corriger) ; "
                f"{diagnostics.unread_no_known_container} n'avaient aucun conteneur connu "
                "(mise en page inconnue)."
            )

    if (
        coverage.offers > 0
        and coverage.counts["unitQuantity"] == 0
        and coverage.counts["unitDoses"] == 0
    ):
        warnings.append(
            "Aucune contenance ni dose par unité : les relevés sont antérieurs à la séparation "
            "unité / total. Lancer la migration reparseQuantities puis le refine, ou attendre "
            "le passage suivant du scrapper à jour."
        )

    verdict = coverage.verdict if conclusive else "non concluant — voir les avertissements"
    return Report(
        coverage=coverage,
        diagnostics=diagnostics,
        verdict=verdict,
        conclusive=conclusive,
        warnings=warnings,
    )


def _format_diagnostics(d: ExtractionDiagnostics) -> list[str]:
    if d.pages == 0:
        return ["Traces d'extraction : aucun relevé pour cette boutique."]
    lines = [f"Traces d'extraction — dernier passage : {d.diagnosed} / {d.pages} relevés diagnostiqués"]
    if d.diagnosed == 0:
        return lines

    def row(label: str, value: int) -> str:
        return f"  {label:<50}{value:>6}   {_pct(value, d.diagnosed):>5.1f} %"

    lines += [
        row("Caractéristiques lues (≥ 1 ligne)", d.details_read),
        row("  aucune lue, mais « EAN » affiché dans la page", d.unread_but_ean_visible),
        row("  aucune lue, aucun conteneur connu", d.unread_no_known_container),
        row("EAN tiré des caractéristiques", d.ean_sources["details"]),
        row("EAN tiré du JSON-LD", d.ean_sources["json-ld"]),
        row("Nœud JSON-LD Product présent", d.json_ld_product),
        row("« Nombre d'articles » affiché dans la page", d.item_count_visible),
        row("« Nombre d'articles » lu", d.declared_pack),
    ]
    for issue, value in sorted(d.pack_issues.items()):
        lines.append(row(f"Conditionnement : {issue}", value))
    if d.containers:
        lines.append("  Conteneurs présents : " + ", ".join(f"{k} ({v})" for k, v in d.containers.items()))
    if d.top_labels:
        lines.append("  Libellés les plus lus : " + ", ".join(f"{k} ({v})" for k, v in d.top_labels))
    return lines


def format_report(report: Report, shop: str, fresh_only: bool) -> str:
    summary = report.coverage
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
        f"Verdict (clé stricte) : {report.verdict}",
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

    lines += ["", *_format_diagnostics(report.diagnostics)]
    for warning in report.warnings:
        lines += ["", f"⚠ {warning}"]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--shop", default="amazon")
    parser.add_argument("--all", action="store_true", help="inclure les offres non relues au dernier passage")
    parser.add_argument("--json", action="store_true", help="sortie JSON")
    args = parser.parse_args()

    with open_database() as db:
        offers = load_offers(db, shop=args.shop, fresh_only=not args.all)
        traces = load_scrape_diagnostics(db, shop=args.shop)

    report = assess(summarize(offers), summarize_diagnostics(traces))
    if args.json:
        print(json.dumps(asdict(report), ensure_ascii=False, indent=2, default=str))
    else:
        print(format_report(report, shop=args.shop, fresh_only=not args.all))


if __name__ == "__main__":
    main()

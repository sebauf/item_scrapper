"""Rapport de couverture d'identité.

Le rapport décide de la suite du projet (grille du spike, §5) : un taux faux
dans un sens ferait abandonner la comparaison à tort, dans l'autre lancer le
second crawler sur une base qui ne le permet pas. D'où des tests sur chaque
compteur, et sur la clé stricte en particulier.
"""
from datetime import datetime, timedelta

from src.reports.identity_coverage import (
    assess,
    format_report,
    load_offers,
    load_scrape_diagnostics,
    summarize,
    summarize_diagnostics,
)

D = datetime(2026, 11, 1)
EAN_A = "3014260610807"
EAN_B = "4005809001209"


def offer(url, **fields):
    doc = {
        "_id": url,
        "shop": "amazon",
        "keyword": "lessive",
        "title": f"Produit {url}",
        "lastSeen": D,
        "ean": None,
        "brand": None,
        "mpn": None,
        "packSize": None,
        "quantity": None,
        "unitQuantity": None,
        "doses": None,
        "unitDoses": None,
    }
    doc.update(fields)
    return doc


LITRE = {"amount": 1.5, "unit": "L"}


class TestCleStricte:
    def test_l_ean_seul_ne_suffit_pas(self):
        """Une offre avec EAN mais sans nombre d'unités établi n'est pas
        comparable strictement : elle pourrait être un lot du vendeur."""
        summary = summarize([offer("u1", ean=EAN_A)])
        assert summary.counts["ean"] == 1
        assert summary.counts["strict"] == 0
        assert summary.counts["ean_without_pack"] == 1
        assert summary.counts["not_comparable"] == 1

    def test_ean_et_lot_etablis_font_la_cle(self):
        summary = summarize([offer("u1", ean=EAN_A, packSize=1), offer("u2", ean=EAN_B, packSize=3)])
        assert summary.counts["strict"] == 2
        assert summary.counts["packSize_1"] == 1
        assert summary.counts["packSize_lot"] == 1
        assert summary.rates["strict"] == 100.0

    def test_les_trois_categories_partitionnent_le_catalogue(self):
        offers = [
            offer("strict", ean=EAN_A, packSize=1),
            offer("attrs", brand="Ariel", packSize=1, unitQuantity=LITRE),
            offer("attrs-doses", brand="Finish", packSize=3, unitDoses=40),
            offer("rien", brand="Ariel"),
            offer("sans-lot", brand="Ariel", unitQuantity=LITRE),
        ]
        counts = summarize(offers).counts
        assert counts["strict"] == 1
        assert counts["by_attributes"] == 2
        assert counts["not_comparable"] == 2
        assert counts["strict"] + counts["by_attributes"] + counts["not_comparable"] == len(offers)


class TestVerdict:
    def test_seuils_de_la_grille(self):
        def verdict(strict, total):
            offers = [offer(f"s{i}", ean=EAN_A, packSize=1) for i in range(strict)]
            offers += [offer(f"n{i}") for i in range(total - strict)]
            return summarize(offers).verdict

        assert verdict(6, 10).startswith("résolu")
        assert verdict(5, 10).startswith("partiel")
        assert verdict(3, 12).startswith("partiel")  # 25 % pile
        assert verdict(2, 10).startswith("insuffisant")

    def test_catalogue_vide(self):
        summary = summarize([])
        assert summary.offers == 0
        assert summary.rates["strict"] == 0.0
        assert "rien à mesurer" in summary.verdict
        report = assess(summary, summarize_diagnostics([]))
        assert "Aucune offre" in format_report(report, "amazon", True)


class TestEanPartages:
    def test_detecte_un_meme_ean_sur_des_lots_differents(self):
        """La preuve, chez une seule enseigne, que l'EAN seul confondrait une
        bouteille et un lot."""
        summary = summarize([
            offer("bouteille", ean=EAN_A, packSize=1),
            offer("lot2", ean=EAN_A, packSize=2),
            offer("doublon1", ean=EAN_B, packSize=1),
            offer("doublon2", ean=EAN_B, packSize=1),
            offer("seul", ean="9999999999999"),
        ])
        groups = summary.shared_ean_groups
        assert groups["total"] == 2
        assert groups["lots_differents"] == 1
        assert groups["meme_lot"] == 1
        assert [ex.ean for ex in summary.shared_ean_examples] == [EAN_A]
        assert {o["packSize"] for o in summary.shared_ean_examples[0].offers} == {1, 2}

    def test_un_lot_inconnu_n_est_pas_compte_comme_different(self):
        summary = summarize([offer("a", ean=EAN_A, packSize=1), offer("b", ean=EAN_A)])
        assert summary.shared_ean_groups["lot_inconnu"] == 1
        assert summary.shared_ean_groups["lots_differents"] == 0


class TestParMotCle:
    def test_taux_par_mot_cle_et_url_suivie(self):
        summary = summarize([
            offer("a", keyword="lessive", ean=EAN_A, packSize=1),
            offer("b", keyword="lessive"),
            offer("c", keyword=None, ean=EAN_B),
        ])
        rows = {row.keyword: row for row in summary.by_keyword}
        assert rows["lessive"].offers == 2
        assert rows["lessive"].strict_pct == 50.0
        assert rows["(URL suivie)"].ean_pct == 100.0
        assert rows["(URL suivie)"].strict_pct == 0.0


class TestChargement:
    def test_ne_retient_que_le_dernier_passage_de_la_boutique(self, db):
        """Même règle de fraîcheur que les écrans : une fiche non relue au
        dernier passage n'est pas visible, elle ne compte pas."""
        db["price_history"].insert_many([
            offer("frais", lastSeen=D),
            offer("ancien", lastSeen=D - timedelta(days=3)),
            offer("indispo", lastSeen=D, unavailable=True),
            offer("autre-boutique", shop="carrefour", lastSeen=D + timedelta(days=1)),
        ])
        assert [o["_id"] for o in load_offers(db)] == ["frais"]
        assert {o["_id"] for o in load_offers(db, fresh_only=False)} == {"frais", "ancien"}
        assert [o["_id"] for o in load_offers(db, shop="carrefour")] == ["autre-boutique"]

    def test_base_vide(self, db):
        assert load_offers(db) == []

    def test_rapport_texte_complet(self, db):
        db["price_history"].insert_many([
            offer("u1", ean=EAN_A, packSize=1, title="Ariel 1,5 L"),
            offer("u2", ean=EAN_A, packSize=2, title="Ariel 1,5 L - Lot de 2"),
        ])
        report = assess(summarize(load_offers(db)), summarize_diagnostics([]))
        text = format_report(report, "amazon", True)
        assert "Clé stricte (EAN + nombre d'unités)" in text
        assert "100.0 %" in text
        assert "nombres d'unités différents : 1" in text
        assert "Ariel 1,5 L - Lot de 2" in text


def trace(**fields):
    """Diagnostic d'un relevé tel que l'écrit le scrapper dans `items_raw`."""
    doc = {
        "eanSource": None,
        "jsonLdProduct": False,
        "detailEntries": 12,
        "detailLabels": ["ean", "marque", "nombre d’articles"],
        "detailContainers": ["detailBullets_feature_div"],
        "mentionsEan": True,
        "mentionsItemCount": True,
        "declaredPackSize": 1,
        "packIssue": None,
    }
    doc.update(fields)
    return {"identityDiagnostics": doc}


class TestTracesDExtraction:
    def test_compte_sources_lectures_et_pannes(self):
        diag = summarize_diagnostics([
            trace(eanSource="details"),
            trace(eanSource="json-ld", jsonLdProduct=True),
            trace(detailEntries=0, detailLabels=[], mentionsEan=True),
            trace(detailEntries=0, detailLabels=[], detailContainers=[], mentionsEan=False),
            trace(declaredPackSize=None, packIssue="pieces-or-pack"),
            {"_id": "relevé d'un scrapper sans diagnostic"},
        ])
        assert diag.pages == 6
        assert diag.diagnosed == 5
        assert diag.ean_sources == {"details": 1, "json-ld": 1, "aucune": 3}
        assert diag.details_read == 3
        assert diag.unread_but_ean_visible == 1
        assert diag.unread_no_known_container == 1
        assert diag.declared_pack == 4
        assert diag.pack_issues == {"pieces-or-pack": 1}
        assert diag.top_labels[0] == ("ean", 3)

    def test_charge_le_dernier_passage_de_la_boutique(self, db):
        db["items_raw"].insert_many([
            {"url": "a", "shop": "amazon", "day": D, **trace()},
            {"url": "b", "shop": "amazon", "day": D - timedelta(days=1), **trace()},
            {"url": "c", "shop": "carrefour", "day": D + timedelta(days=1), **trace()},
        ])
        assert len(load_scrape_diagnostics(db)) == 1
        assert load_scrape_diagnostics(db, shop="inconnue") == []


def healthy_offers(n=10, strict=7):
    return [
        offer(f"s{i}", ean=EAN_A, packSize=1, unitQuantity=LITRE) for i in range(strict)
    ] + [offer(f"n{i}") for i in range(n - strict)]


class TestVerdictFinal:
    def test_lecture_saine_le_verdict_de_la_grille_tient(self):
        report = assess(summarize(healthy_offers()), summarize_diagnostics([trace()] * 20))
        assert report.conclusive
        assert report.verdict.startswith("résolu")
        assert report.warnings == []

    def test_cas_reel_caracteristiques_jamais_lues(self):
        """La forme de la première mesure réelle (11/2026) : EAN et marque
        présents sur les mêmes 10 % de fiches, référence fabricant à 0 % —
        tout vient du JSON-LD, la section de caractéristiques n'est jamais
        lue. Le rapport doit refuser de conclure « insuffisant »."""
        offers = [offer(f"j{i}", ean=EAN_A, brand="Brita") for i in range(9)]
        offers += [offer(f"n{i}") for i in range(81)]
        traces = [trace(eanSource="json-ld", jsonLdProduct=True, detailEntries=0, detailLabels=[], mentionsEan=False)] * 9
        traces += [trace(detailEntries=0, detailLabels=[], mentionsEan=True)] * 81
        report = assess(summarize(offers), summarize_diagnostics(traces))

        assert not report.conclusive
        assert report.verdict.startswith("non concluant")
        assert any("0.0 % des fiches" in w and "81 fiche(s)" in w for w in report.warnings)
        text = format_report(report, "amazon", True)
        assert "non concluant" in text
        assert "insuffisant" not in text

    def test_sans_trace_d_extraction_pas_de_verdict(self):
        report = assess(summarize(healthy_offers()), summarize_diagnostics([{"_id": "x"}] * 20))
        assert not report.conclusive
        assert "antérieur au diagnostic" in report.warnings[0]

    def test_trop_peu_de_fiches_pour_juger_la_lecture(self):
        traces = [trace(detailEntries=0)] * 5
        report = assess(summarize(healthy_offers()), summarize_diagnostics(traces))
        assert report.conclusive

    def test_signale_l_absence_de_mesures_par_unite(self):
        offers = [offer(f"s{i}", ean=EAN_A, packSize=1) for i in range(10)]
        report = assess(summarize(offers), summarize_diagnostics([trace()] * 20))
        assert report.conclusive
        assert any("reparseQuantities" in w for w in report.warnings)

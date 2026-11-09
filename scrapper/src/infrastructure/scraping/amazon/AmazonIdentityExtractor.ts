import type { Page } from 'playwright';
import { mergeJsonLdProducts, parseJsonLdProducts, type JsonLdProduct } from '../shared/JsonLdParser.js';
import { parseQuantity, type ParsedQuantity } from '../shared/QuantityParser.js';
import { reconcilePack, type PackIdentity } from '../shared/PackReconciler.js';
import type { IdentityDiagnostics } from '../../../domain/product/Product.js';
import {
  EMPTY_IDENTITY,
  normalizeLabel,
  parseAmazonDetails,
  splitDetailBullet,
  type AmazonIdentity,
  type DetailEntry,
} from './AmazonIdentityParser.js';

/**
 * Côté DOM de l'extraction d'identité : ce fichier ne contient que des
 * sélecteurs et des appels Playwright. Toute la logique vit dans les modules
 * purs (`AmazonIdentityParser`, `JsonLdParser`, `QuantityParser`), qui se
 * testent sans navigateur — même découpage que `PriceParser` face à
 * `AmazonProductHandler`.
 */

/** Les deux mises en page des caractéristiques, selon la catégorie produit. */
const DETAIL_BULLET_SELECTOR =
  '#detailBullets_feature_div li span.a-list-item, #detailBulletsWrapper_feature_div li span.a-list-item';
const DETAIL_TABLE_SELECTOR =
  '#productDetails_detailBullets_sections1 tr, #productDetails_techSpec_section_1 tr, #productDetails_techSpec_section_2 tr, #productDetails_db_sections tr, table.prodDetTable tr';

/**
 * Conteneurs de caractéristiques connus, toutes mises en page confondues.
 * Leur présence est relevée pour le diagnostic : une fiche où l'un d'eux
 * existe mais d'où aucune ligne n'a été lue désigne un sélecteur obsolète ;
 * une fiche où aucun n'existe, une mise en page inconnue.
 */
const DETAIL_CONTAINER_IDS = [
  'detailBullets_feature_div',
  'detailBulletsWrapper_feature_div',
  'prodDetails',
  'productDetails_feature_div',
  'productDetails_techSpec_section_1',
  'productDetails_detailBullets_sections1',
  'productDetails_expanderTables_depthLeftSections',
  'productOverview_feature_div',
  'productFactsDesktopExpander',
  'tech',
  'poExpander',
];

/** Plafonds : le diagnostic ne doit pas faire grossir `items_raw` sans borne. */
const MAX_LABELS = 40;
const MAX_LABEL_LENGTH = 60;

interface PageSignals {
  detailContainers: string[];
  mentionsEan: boolean;
  mentionsItemCount: boolean;
}

const NO_SIGNALS: PageSignals = { detailContainers: [], mentionsEan: false, mentionsItemCount: false };

export const EMPTY_DIAGNOSTICS: IdentityDiagnostics = Object.freeze({
  eanSource: null,
  jsonLdProduct: false,
  detailEntries: 0,
  detailLabels: [],
  ...NO_SIGNALS,
  declaredPackSize: null,
  packIssue: null,
});

export interface ExtractedIdentity extends AmazonIdentity {
  /** Ce que le JSON-LD de la page a donné, `null` s'il n'en publie aucun. */
  jsonLd: JsonLdProduct | null;
  /** Nombre de blocs `application/ld+json` présents, publiant un produit ou non. */
  jsonLdScriptCount: number;
  /** Ce que le titre seul dit du conditionnement — conservé pour la mesure. */
  quantity: ParsedQuantity;
  /** Conditionnement retenu : titre croisé avec « Nombre d'articles ». */
  pack: PackIdentity;
  /** D'où vient l'EAN finalement retenu — mesure clé du spike. */
  eanSource: 'json-ld' | 'details' | null;
  /** Traces de l'extraction, enregistrées avec le relevé. */
  diagnostics: IdentityDiagnostics;
}

/**
 * Le texte est pris sur une copie du `body` débarrassée des scripts : le
 * texte *visible* (`innerText`) ignorerait une section repliée que les
 * sélecteurs, eux, lisent bien ; le texte brut compterait les « EAN » des
 * blobs JSON embarqués.
 */
export async function extractPageSignals(page: Page): Promise<PageSignals> {
  return page
    .evaluate((ids) => {
      const detailContainers = ids.filter((id) => document.getElementById(id) !== null);
      const body = document.body?.cloneNode(true) as HTMLElement | undefined;
      body?.querySelectorAll('script, style, noscript, template').forEach((node) => node.remove());
      const text = body?.textContent ?? '';
      return {
        detailContainers,
        mentionsEan: /\bEAN\b/.test(text),
        mentionsItemCount: /nombre d.articles/i.test(text),
      };
    }, DETAIL_CONTAINER_IDS)
    .catch(() => NO_SIGNALS);
}

/** Libellés normalisés, dédoublonnés, bornés en nombre et en longueur. */
export function summarizeLabels(entries: readonly DetailEntry[]): string[] {
  const labels = new Set<string>();
  for (const entry of entries) {
    const label = normalizeLabel(entry.label).slice(0, MAX_LABEL_LENGTH);
    if (label.length > 0) labels.add(label);
    if (labels.size >= MAX_LABELS) break;
  }
  return [...labels];
}

export async function extractJsonLdScripts(page: Page): Promise<string[]> {
  return page
    .$$eval('script[type="application/ld+json"]', (nodes) =>
      nodes.map((node) => node.textContent ?? '').filter((text) => text.trim().length > 0),
    )
    .catch(() => [] as string[]);
}

export async function extractDetailEntries(page: Page): Promise<DetailEntry[]> {
  const bulletTexts = await page
    .$$eval(DETAIL_BULLET_SELECTOR, (nodes) =>
      nodes.map((node) => node.textContent ?? '').filter((text) => text.trim().length > 0),
    )
    .catch(() => [] as string[]);

  const tableRows = await page
    .$$eval(DETAIL_TABLE_SELECTOR, (rows) =>
      rows
        .map((row) => ({
          label: row.querySelector('th')?.textContent ?? '',
          value: row.querySelector('td')?.textContent ?? '',
        }))
        .filter((entry) => entry.label.trim().length > 0 && entry.value.trim().length > 0),
    )
    .catch(() => [] as DetailEntry[]);

  const fromBullets = bulletTexts
    .map(splitDetailBullet)
    .filter((entry): entry is DetailEntry => entry !== null);

  return [...fromBullets, ...tableRows];
}

/**
 * Cascade d'identité pour Amazon : le JSON-LD d'abord s'il porte un GTIN,
 * les caractéristiques ensuite.
 *
 * L'ordre n'est pas universel — il est propre à cette enseigne et sera
 * vraisemblablement inverse chez un distributeur alimentaire, dont le
 * JSON-LD est généralement complet. C'est précisément pourquoi chaque
 * boutique garde son extracteur, au-dessus de parseurs partagés.
 */
export async function extractAmazonIdentity(page: Page, title: string): Promise<ExtractedIdentity> {
  const [scripts, entries, signals] = await Promise.all([
    extractJsonLdScripts(page),
    extractDetailEntries(page),
    extractPageSignals(page),
  ]);

  const jsonLd = mergeJsonLdProducts(parseJsonLdProducts(scripts));
  const details = entries.length > 0 ? parseAmazonDetails(entries) : EMPTY_IDENTITY;

  const quantity = parseQuantity(title);
  const pack = reconcilePack(quantity, details.packSize);
  const ean = jsonLd?.gtin ?? details.ean;
  const eanSource = jsonLd?.gtin ? 'json-ld' : details.ean ? 'details' : null;

  return {
    ean,
    eanSource,
    brand: details.brand ?? jsonLd?.brand ?? null,
    mpn: details.mpn ?? jsonLd?.mpn ?? null,
    asin: details.asin,
    ambiguousEan: details.ambiguousEan,
    packSize: details.packSize,
    jsonLd,
    jsonLdScriptCount: scripts.length,
    quantity,
    pack,
    diagnostics: {
      eanSource,
      jsonLdProduct: jsonLd !== null,
      detailEntries: entries.length,
      detailLabels: summarizeLabels(entries),
      ...signals,
      declaredPackSize: details.packSize,
      packIssue: pack.issue,
    },
  };
}

import type { Page } from 'playwright';
import { mergeJsonLdProducts, parseJsonLdProducts, type JsonLdProduct } from '../shared/JsonLdParser.js';
import { parseQuantity, type ParsedQuantity } from '../shared/QuantityParser.js';
import {
  EMPTY_IDENTITY,
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

export interface ExtractedIdentity extends AmazonIdentity {
  /** Ce que le JSON-LD de la page a donné, `null` s'il n'en publie aucun. */
  jsonLd: JsonLdProduct | null;
  /** Nombre de blocs `application/ld+json` présents, publiant un produit ou non. */
  jsonLdScriptCount: number;
  quantity: ParsedQuantity;
  /** D'où vient l'EAN finalement retenu — mesure clé du spike. */
  eanSource: 'json-ld' | 'details' | null;
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
  const [scripts, entries] = await Promise.all([
    extractJsonLdScripts(page),
    extractDetailEntries(page),
  ]);

  const jsonLd = mergeJsonLdProducts(parseJsonLdProducts(scripts));
  const details = entries.length > 0 ? parseAmazonDetails(entries) : EMPTY_IDENTITY;

  const ean = jsonLd?.gtin ?? details.ean;
  const eanSource = jsonLd?.gtin ? 'json-ld' : details.ean ? 'details' : null;

  return {
    ean,
    eanSource,
    brand: details.brand ?? jsonLd?.brand ?? null,
    mpn: details.mpn ?? jsonLd?.mpn ?? null,
    asin: details.asin,
    ambiguousEan: details.ambiguousEan,
    jsonLd,
    jsonLdScriptCount: scripts.length,
    quantity: parseQuantity(title),
  };
}

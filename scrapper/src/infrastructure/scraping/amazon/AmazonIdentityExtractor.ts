import type { Page } from 'playwright';
import { splitDetailBullet, type DetailEntry } from './AmazonIdentityParser.js';
import {
  NO_SIGNALS,
  resolveAmazonIdentity,
  type ExtractedIdentity,
  type PageSignals,
} from './AmazonIdentityCascade.js';

/**
 * Côté DOM de l'extraction d'identité : ce fichier ne contient que des
 * sélecteurs et des appels Playwright. Toute la logique vit dans les modules
 * purs (`AmazonIdentityCascade`, `AmazonIdentityParser`, `JsonLdParser`,
 * `QuantityParser`), qui se testent sans navigateur — même découpage que
 * `PriceParser` face à `AmazonProductHandler`.
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

/** Lit la page, puis délègue la cascade à `resolveAmazonIdentity`, pure. */
export async function extractAmazonIdentity(page: Page, title: string): Promise<ExtractedIdentity> {
  const [jsonLdScripts, detailEntries, signals] = await Promise.all([
    extractJsonLdScripts(page),
    extractDetailEntries(page),
    extractPageSignals(page),
  ]);
  return resolveAmazonIdentity({ jsonLdScripts, detailEntries, signals }, title);
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
        // Les deux langues : une page servie en anglais nomme le code-barres
        // « Global Trade Identification Number ».
        mentionsEan: /\b(EAN|GTIN)\b|global trade identification number/i.test(text),
        // « Nombre d’ articles » (espace après l'apostrophe) existe aussi.
        mentionsItemCount: /nombre d\W{0,3}articles|number of items/i.test(text),
      };
    }, DETAIL_CONTAINER_IDS)
    .catch(() => NO_SIGNALS);
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

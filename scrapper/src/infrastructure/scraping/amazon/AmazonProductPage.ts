import type { Page } from 'playwright';
import { toHighResImageUrls } from './ImageUrlParser.js';
import { AVAILABILITY_SELECTOR, OWN_PRICE_SELECTORS } from './AmazonOfferParser.js';
import { variantUrls } from './AmazonUrl.js';

/**
 * Côté DOM d'une fiche produit : sélecteurs et appels Playwright, rien
 * d'autre. Chaque fonction renvoie le texte brut ; les décisions (prix,
 * disponibilité, identité) sont prises par les parseurs purs.
 */

const TITLE_SELECTOR = '#productTitle';

/**
 * N'importe quel prix de la page, **y compris celui d'un autre article**.
 * Ne sert qu'au garde-fou `hasAnyPrice`, jamais à lire un prix.
 */
const ANY_PRICE_SELECTOR = '.a-price .a-offscreen';

const CROSSED_OUT_PRICE_SELECTOR = '.srpPriceBlockAUI .a-offscreen';

/** Le montant du prix unitaire ; son unité est écrite dans un parent proche. */
const UNIT_PRICE_SELECTOR = '.apex-priceperunit-value';
const UNIT_PRICE_LOOKUP_DEPTH = 5;
const UNIT_PRICE_MAX_LENGTH = 100;
const UNIT_PRICE_HINT_PATTERN = /par\s+\w|\/\s*\w/i;

/** Message de livraison, mises en page ancienne et récente. */
const DELIVERY_MESSAGE_SELECTOR =
  '#delivery-message, #mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE';

const THUMBNAIL_SELECTOR = '#altImages img';

/**
 * Sélecteur de déclinaisons (taille, parfum…), trois mises en page. Jamais les
 * carrousels : un article indisponible peut avoir des déclinaisons en stock,
 * mais ses remplaçants ne sont pas ses variantes.
 */
const VARIANT_PICKER_SELECTOR = '#twister, #twister-plus-inline-twister-view, #twisterContainer';

/** Défilement et pause d'une durée aléatoire, pour ne pas lire la page comme un robot. */
const SCROLL_MIN_PX = 400;
const SCROLL_RANDOM_RANGE_PX = 300;
const WAIT_MIN_MS = 800;
const WAIT_RANDOM_RANGE_MS = 600;

export async function simulateHumanScroll(page: Page): Promise<void> {
  await page.evaluate(
    ({ minPx, rangePx }) => window.scrollBy(0, minPx + Math.random() * rangePx),
    { minPx: SCROLL_MIN_PX, rangePx: SCROLL_RANDOM_RANGE_PX },
  );
  await waitLikeAHuman(page);
}

export async function waitLikeAHuman(page: Page): Promise<void> {
  await page.waitForTimeout(WAIT_MIN_MS + Math.random() * WAIT_RANDOM_RANGE_MS);
}

/** Titre de la fiche, `''` s'il manque (page de blocage, le plus souvent). */
export async function extractTitle(page: Page): Promise<string> {
  return page.$eval(TITLE_SELECTOR, (el) => el.textContent?.trim() ?? '').catch(() => '');
}

export async function extractAvailabilityText(page: Page): Promise<string | null> {
  const texts = await page
    .$$eval(AVAILABILITY_SELECTOR, (els) => els.map((el) => el.textContent ?? ''))
    .catch(() => [] as string[]);
  const joined = texts.join(' ').replace(/\s+/g, ' ').trim();
  return joined || null;
}

/** Textes bruts de l'offre, lus dans cet ordre. */
export interface OfferTexts {
  priceText: string | null;
  crossedOutPriceText: string | null;
  unitPriceRaw: string | null;
  deliveryDate: string | null;
  images: string[];
}

export async function extractOfferTexts(page: Page): Promise<OfferTexts> {
  const priceText = await extractPriceText(page);
  const crossedOutPriceText = await extractCrossedOutPriceText(page);
  // Un prix unitaire sans prix principal ne peut être que celui d'un autre
  // article : il suit le sort du prix.
  const unitPriceRaw = priceText ? await extractUnitPriceRaw(page) : null;
  const deliveryDate = await extractDeliveryDate(page);
  const images = await extractImages(page);
  return { priceText, crossedOutPriceText, unitPriceRaw, deliveryDate, images };
}

/**
 * Prix de l'article lui-même, cherché uniquement dans ses blocs de prix
 * (cf. `OWN_PRICE_SELECTORS`). Jamais de repli sur un `.a-price` quelconque
 * de la page : sur une fiche sans offre, ce serait le prix d'un remplaçant.
 */
async function extractPriceText(page: Page): Promise<string | null> {
  for (const selector of OWN_PRICE_SELECTORS) {
    const text = await page
      .$eval(selector, (el) => el.textContent?.trim() ?? null)
      .catch(() => null);
    if (text) return text;
  }
  return null;
}

/** Vrai si la page affiche au moins un prix, où qu'il soit. */
export async function hasAnyPrice(page: Page): Promise<boolean> {
  return page
    .$(ANY_PRICE_SELECTOR)
    .then((el) => el !== null)
    .catch(() => false);
}

async function extractCrossedOutPriceText(page: Page): Promise<string | null> {
  return page
    .$eval(CROSSED_OUT_PRICE_SELECTOR, (el) => el.textContent?.trim() ?? null)
    .catch(() => null);
}

async function extractUnitPriceRaw(page: Page): Promise<string | null> {
  return page.evaluate(
    ({ selector, lookupDepth, maxLength, hintPattern }) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      let node = el.parentElement;
      for (let i = 0; i < lookupDepth; i++) {
        const text = node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        if (new RegExp(hintPattern, 'i').test(text)) return text.substring(0, maxLength);
        node = node?.parentElement ?? null;
      }
      return null;
    },
    {
      selector: UNIT_PRICE_SELECTOR,
      lookupDepth: UNIT_PRICE_LOOKUP_DEPTH,
      maxLength: UNIT_PRICE_MAX_LENGTH,
      hintPattern: UNIT_PRICE_HINT_PATTERN.source,
    },
  );
}

async function extractDeliveryDate(page: Page): Promise<string | null> {
  return page
    .$eval(DELIVERY_MESSAGE_SELECTOR, (el) => el.textContent?.trim().replace(/\s+/g, ' ') ?? null)
    .catch(() => null);
}

async function extractImages(page: Page): Promise<string[]> {
  const thumbnails = await page
    .$$eval(THUMBNAIL_SELECTOR, (els) => els.map((el) => el.getAttribute('src') ?? '').filter(Boolean))
    .catch(() => [] as string[]);
  return toHighResImageUrls(thumbnails);
}

/** URLs des autres déclinaisons de la fiche (`currentAsin` exclu). */
export async function extractVariantUrls(page: Page, currentAsin: string | null): Promise<string[]> {
  const { dataAsins, dpUrls } = await page
    .evaluate((selector) => {
      const container = document.querySelector(selector);
      const attributes = (name: string) =>
        Array.from(container?.querySelectorAll(`[${name}]`) ?? [], (el) => el.getAttribute(name) ?? '');
      return { dataAsins: attributes('data-asin'), dpUrls: attributes('data-dp-url') };
    }, VARIANT_PICKER_SELECTOR)
    .catch(() => ({ dataAsins: [] as string[], dpUrls: [] as string[] }));
  return variantUrls(dataAsins, dpUrls, currentAsin);
}

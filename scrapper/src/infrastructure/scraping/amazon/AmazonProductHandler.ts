import type { Page } from 'playwright';
import type { PlaywrightCrawlingContext } from 'crawlee';
import type { IProductRepository } from '../../../domain/product/IProductRepository.js';
import { parsePrice, parseUnitPrice } from './PriceParser.js';
import { toHighResImageUrls } from './ImageUrlParser.js';
import { extractAmazonIdentity } from './AmazonIdentityExtractor.js';
import { AVAILABILITY_SELECTOR, OWN_PRICE_SELECTORS, isUnavailable } from './AmazonOfferParser.js';

const SCROLL_MIN_PX = 400;
const SCROLL_RANDOM_RANGE_PX = 300;
const WAIT_MIN_MS = 800;
const WAIT_RANDOM_RANGE_MS = 600;
const UNIT_PRICE_LOOKUP_DEPTH = 5;
const UNIT_PRICE_MAX_LENGTH = 100;
const UNIT_PRICE_HINT_PATTERN = /par\s+\w|\/\s*\w/i;
const PRODUCT_PATH_RE = /\/dp\/[A-Z0-9]{10}/i;
const PRODUCT_ASIN_RE = /\/dp\/([A-Z0-9]{10})/i;
const BLOCK_PATH_FRAGMENTS = ['/errors/validateCaptcha', '/ap/signin', '/ap/cvf'];

async function simulateHumanScroll(page: Page): Promise<void> {
  await page.evaluate(
    ({ minPx, rangePx }) => window.scrollBy(0, minPx + Math.random() * rangePx),
    { minPx: SCROLL_MIN_PX, rangePx: SCROLL_RANDOM_RANGE_PX },
  );
  await page.waitForTimeout(WAIT_MIN_MS + Math.random() * WAIT_RANDOM_RANGE_MS);
}

async function extractTitle(page: Page): Promise<string> {
  return page.$eval('#productTitle', (el) => el.textContent?.trim() ?? '').catch(() => '');
}

async function extractAvailabilityText(page: Page): Promise<string | null> {
  const texts = await page
    .$$eval(AVAILABILITY_SELECTOR, (els) => els.map((el) => el.textContent ?? ''))
    .catch(() => [] as string[]);
  const joined = texts.join(' ').replace(/\s+/g, ' ').trim();
  return joined || null;
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
async function hasAnyPrice(page: Page): Promise<boolean> {
  return page
    .$('.a-price .a-offscreen')
    .then((el) => el !== null)
    .catch(() => false);
}

async function extractCrossedOutPriceText(page: Page): Promise<string | null> {
  return page
    .$eval('.srpPriceBlockAUI .a-offscreen', (el) => el.textContent?.trim() ?? null)
    .catch(() => null);
}

async function extractUnitPriceRaw(page: Page): Promise<string | null> {
  return page.evaluate(
    ({ lookupDepth, maxLength, hintPattern }) => {
      const el = document.querySelector('.apex-priceperunit-value');
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
      lookupDepth: UNIT_PRICE_LOOKUP_DEPTH,
      maxLength: UNIT_PRICE_MAX_LENGTH,
      hintPattern: UNIT_PRICE_HINT_PATTERN.source,
    },
  );
}

async function extractDeliveryDate(page: Page): Promise<string | null> {
  return page
    .$eval(
      '#delivery-message, #mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE',
      (el) => el.textContent?.trim().replace(/\s+/g, ' ') ?? null,
    )
    .catch(() => null);
}

async function extractImages(page: Page): Promise<string[]> {
  const thumbnails = await page
    .$$eval('#altImages img', (els) =>
      els.map((el) => el.getAttribute('src') ?? '').filter(Boolean),
    )
    .catch(() => [] as string[]);
  return toHighResImageUrls(thumbnails);
}

async function extractVariantUrls(page: Page, currentAsin: string | null): Promise<string[]> {
  const asins = await page
    .evaluate((asin) => {
      const container = document.querySelector(
        '#twister, #twister-plus-inline-twister-view, #twisterContainer',
      );
      if (!container) return [] as string[];

      const found = new Set<string>();
      container.querySelectorAll('[data-asin]').forEach((el) => {
        const value = el.getAttribute('data-asin');
        if (value) found.add(value);
      });
      container.querySelectorAll('[data-dp-url]').forEach((el) => {
        const match = (el.getAttribute('data-dp-url') ?? '').match(/\/dp\/([A-Z0-9]{10})/);
        if (match) found.add(match[1]);
      });
      if (asin) found.delete(asin);
      return Array.from(found);
    }, currentAsin)
    .catch(() => [] as string[]);

  return asins.map((asin) => `https://www.amazon.fr/dp/${asin}/`);
}

/**
 * Les déclinaisons (taille, parfum…) sont lues dans le sélecteur de
 * variantes, jamais dans les carrousels : un article indisponible peut avoir
 * des déclinaisons en stock, mais ses remplaçants ne sont pas ses variantes.
 */
async function enqueueVariants(
  page: Page,
  currentAsin: string | null,
  keyword: string | undefined,
  url: string,
  enqueueLinks: PlaywrightCrawlingContext['enqueueLinks'],
  log: PlaywrightCrawlingContext['log'],
): Promise<void> {
  const variantUrls = await extractVariantUrls(page, currentAsin);
  if (variantUrls.length > 0) {
    log.info(`Found ${variantUrls.length} variant(s)`, { url, variantUrls });
    await enqueueLinks({ urls: variantUrls, userData: { keyword } });
  }
}

function isBlockPage(url: string): boolean {
  return BLOCK_PATH_FRAGMENTS.some((fragment) => url.includes(fragment));
}

function isDeadProductRedirect(originalUrl: string, finalUrl: string): boolean {
  return PRODUCT_PATH_RE.test(originalUrl) && !PRODUCT_PATH_RE.test(finalUrl) && !isBlockPage(finalUrl);
}

export function createAmazonProductHandler(
  productRepository: IProductRepository,
): (context: PlaywrightCrawlingContext) => Promise<void> {
  return async ({ page, request, enqueueLinks, log }) => {
    const { keyword } = request.userData as { keyword?: string };

    await simulateHumanScroll(page);

    if (isDeadProductRedirect(request.url, page.url())) {
      log.info(`Dead product (redirected away), marking unavailable`, {
        url: request.url,
        finalUrl: page.url(),
      });
      await productRepository.markUnavailable(request.url);
      return;
    }

    const title = await extractTitle(page);

    if (!title) {
      log.warning('Skipped save: page failed to extract a title (likely blocked or unavailable)', {
        url: request.url,
      });
      return;
    }

    const currentAsin = request.url.match(PRODUCT_ASIN_RE)?.[1] ?? null;

    // La disponibilité se juge avant le prix : une fiche « Actuellement
    // indisponible » affiche des articles de remplacement avec leurs prix,
    // et aucun d'eux n'est le prix de cet article. Même traitement qu'une
    // fiche redirigée — plus scorée, historique conservé, drapeau levé au
    // prochain passage réussi.
    const availabilityText = await extractAvailabilityText(page);
    if (isUnavailable(availabilityText)) {
      log.info('Product currently unavailable, marking unavailable (no price recorded)', {
        url: request.url,
        availability: availabilityText,
      });
      await productRepository.markUnavailable(request.url);
      await enqueueVariants(page, currentAsin, keyword, request.url, enqueueLinks, log);
      return;
    }

    const priceText = await extractPriceText(page);
    const crossedOutPriceText = await extractCrossedOutPriceText(page);
    // Un prix unitaire sans prix principal ne peut être que celui d'un autre
    // article : il suit le sort du prix.
    const unitPriceRaw = priceText ? await extractUnitPriceRaw(page) : null;
    const deliveryDate = await extractDeliveryDate(page);
    const images = await extractImages(page);
    const identity = await extractAmazonIdentity(page, title);

    log.info(`Scraped: ${title} — ${priceText ?? 'no price'}`, {
      url: request.url,
      ean: identity.ean,
      eanSource: identity.eanSource,
    });

    // Garde-fou contre une refonte d'Amazon : si la page montre des prix mais
    // qu'aucun n'est dans les blocs de l'article, soit l'article n'a pas
    // d'offre principale (vendu par des tiers), soit nos sélecteurs sont
    // devenus obsolètes. Un taux élevé de ce message signale le second cas.
    if (!priceText && (await hasAnyPrice(page))) {
      log.warning("Prices on the page, none in the product's own price block: price not recorded", {
        url: request.url,
        availability: availabilityText,
      });
    }

    // Les refus d'identité sont journalisés : ce sont eux qu'il faudra
    // surveiller si le taux d'extraction se dégrade après une refonte
    // d'Amazon. Ils ne bloquent rien — la fiche est enregistrée sans
    // identifiant, et la cascade de rapprochement sait faire avec.
    if (identity.ambiguousEan) {
      log.warning('Plusieurs EAN sur la fiche : identité indécidable', { url: request.url });
    }
    if (identity.quantity.ambiguous) {
      log.warning('Contenances multiples dans le titre : contenance non retenue', {
        url: request.url,
        title,
      });
    }
    if (identity.quantity.dosesAmbiguous) {
      log.warning('Doses indécidables (unité ou lot ?) : doses non retenues', {
        url: request.url,
        title,
      });
    }
    if (identity.pack.issue !== null) {
      log.warning('Nombre d\'unités du titre et de la fiche en désaccord', {
        url: request.url,
        issue: identity.pack.issue,
        titlePackSize: identity.quantity.packSize,
        declaredPackSize: identity.packSize,
      });
    }

    await productRepository.save({
      url: request.url,
      title,
      price: parsePrice(priceText),
      crossedOutPrice: parsePrice(crossedOutPriceText),
      unitPrice: parseUnitPrice(unitPriceRaw),
      deliveryDate,
      images,
      shop: 'amazon',
      keyword: keyword ?? null,
      scrapedAt: new Date(),
      ean: identity.ean,
      brand: identity.brand,
      mpn: identity.mpn,
      quantity: identity.pack.quantity,
      unitQuantity: identity.pack.unitQuantity,
      packSize: identity.pack.packSize,
      doses: identity.pack.doses,
      unitDoses: identity.pack.unitDoses,
      identityDiagnostics: identity.diagnostics,
    });

    await enqueueVariants(page, currentAsin, keyword, request.url, enqueueLinks, log);
  };
}

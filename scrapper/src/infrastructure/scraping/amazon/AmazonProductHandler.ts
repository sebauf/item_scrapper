import type { Page } from 'playwright';
import type { PlaywrightCrawlingContext } from 'crawlee';
import type { IProductRepository } from '../../../domain/product/IProductRepository.js';
import { parsePrice, parseUnitPrice } from './PriceParser.js';
import { toHighResImageUrls } from './ImageUrlParser.js';

const SCROLL_MIN_PX = 400;
const SCROLL_RANDOM_RANGE_PX = 300;
const WAIT_MIN_MS = 800;
const WAIT_RANDOM_RANGE_MS = 600;
const UNIT_PRICE_LOOKUP_DEPTH = 5;
const UNIT_PRICE_MAX_LENGTH = 100;
const UNIT_PRICE_HINT_PATTERN = /par\s+\w|\/\s*\w/i;
const PRODUCT_PATH_RE = /\/dp\/[A-Z0-9]{10}/i;
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

async function extractPriceText(page: Page): Promise<string | null> {
  return page
    .$eval('.apex-pricetopay-value .a-offscreen', (el) => el.textContent?.trim() ?? null)
    .catch(() =>
      page
        .$eval('.a-price .a-offscreen', (el) => el.textContent?.trim() ?? null)
        .catch(() => null),
    );
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

function isBlockPage(url: string): boolean {
  return BLOCK_PATH_FRAGMENTS.some((fragment) => url.includes(fragment));
}

function isDeadProductRedirect(originalUrl: string, finalUrl: string): boolean {
  return PRODUCT_PATH_RE.test(originalUrl) && !PRODUCT_PATH_RE.test(finalUrl) && !isBlockPage(finalUrl);
}

export function createAmazonProductHandler(
  productRepository: IProductRepository,
): (context: PlaywrightCrawlingContext) => Promise<void> {
  return async ({ page, request, log }) => {
    const { keyword } = request.userData as { keyword?: string };

    await simulateHumanScroll(page);

    if (isDeadProductRedirect(request.url, page.url())) {
      log.info(`Dead product (redirected away), removing from tracking`, {
        url: request.url,
        finalUrl: page.url(),
      });
      await productRepository.deleteByUrl(request.url);
      return;
    }

    const title = await extractTitle(page);

    if (!title) {
      log.warning('Skipped save: page failed to extract a title (likely blocked or unavailable)', {
        url: request.url,
      });
      return;
    }

    const priceText = await extractPriceText(page);
    const crossedOutPriceText = await extractCrossedOutPriceText(page);
    const unitPriceRaw = await extractUnitPriceRaw(page);
    const deliveryDate = await extractDeliveryDate(page);
    const images = await extractImages(page);

    log.info(`Scraped: ${title} — ${priceText ?? 'no price'}`, { url: request.url });

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
    });
  };
}

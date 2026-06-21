import type { PlaywrightCrawlingContext } from 'crawlee';
import type { IProductRepository } from '../../../domain/product/IProductRepository.js';
import { parsePrice, parseUnitPrice } from './PriceParser.js';

export function createAmazonProductHandler(
  productRepository: IProductRepository,
): (context: PlaywrightCrawlingContext) => Promise<void> {
  return async ({ page, request, log }) => {
    const { keyword } = request.userData as { keyword?: string };

    await page.evaluate(() => window.scrollBy(0, 400 + Math.random() * 300));
    await page.waitForTimeout(800 + Math.random() * 600);

    const title = await page
      .$eval('#productTitle', (el) => el.textContent?.trim() ?? '')
      .catch(() => '');

    const priceText = await page
      .$eval('.apex-pricetopay-value .a-offscreen', (el) => el.textContent?.trim() ?? null)
      .catch(() =>
        page
          .$eval('.a-price .a-offscreen', (el) => el.textContent?.trim() ?? null)
          .catch(() => null),
      );

    const crossedOutPriceText = await page
      .$eval('.srpPriceBlockAUI .a-offscreen', (el) => el.textContent?.trim() ?? null)
      .catch(() => null);

    const unitPriceRaw = await page.evaluate(() => {
      const el = document.querySelector('.apex-priceperunit-value');
      if (!el) return null;
      let node = el.parentElement;
      for (let i = 0; i < 5; i++) {
        const text = node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        if (/par\s+\w|\/\s*\w/i.test(text)) return text.substring(0, 100);
        node = node?.parentElement ?? null;
      }
      return null;
    });

    const deliveryDate = await page
      .$eval(
        '#delivery-message, #mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE',
        (el) => el.textContent?.trim().replace(/\s+/g, ' ') ?? null,
      )
      .catch(() => null);

    const images = await page
      .$$eval('#altImages img', (els) =>
        els.map((el) => el.getAttribute('src') ?? '').filter(Boolean),
      )
      .catch(() => [] as string[]);

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

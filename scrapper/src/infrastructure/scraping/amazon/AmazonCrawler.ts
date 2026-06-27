import { PlaywrightCrawler, createPlaywrightRouter } from 'crawlee';
import type { IProductRepository } from '../../../domain/product/IProductRepository.js';
import type { IShopScraper } from '../../../application/ports/IShopScraper.js';
import type { Keyword } from '../../../domain/keyword/Keyword.js';
import { amazonSearchHandler } from './AmazonSearchHandler.js';
import { createAmazonProductHandler } from './AmazonProductHandler.js';

const KNOWN_PRODUCTS_LIMIT_PER_KEYWORD = 150;

export class AmazonCrawler implements IShopScraper {
  constructor(private readonly productRepository: IProductRepository) {}

  async scrape(keywords: readonly Keyword[]): Promise<void> {
    const crawler = this.buildCrawler();
    const requests = [
      ...this.buildSearchRequests(keywords),
      ...(await this.buildKnownProductRequests(keywords)),
    ];
    await crawler.run(requests);
  }

  private buildCrawler(): PlaywrightCrawler {
    const router = createPlaywrightRouter();
    router.addHandler('SEARCH', amazonSearchHandler);
    router.addDefaultHandler(createAmazonProductHandler(this.productRepository));

    return new PlaywrightCrawler({
      maxRequestsPerCrawl: parseInt(process.env.MAX_REQUESTS_PER_CRAWL ?? '200', 10),
      maxConcurrency: 2,
      maxRequestsPerMinute: 10,
      requestHandler: router,
      useSessionPool: true,
      sessionPoolOptions: {
        maxPoolSize: 10,
        sessionOptions: { maxUsageCount: 50, maxErrorScore: 3 },
      },
      preNavigationHooks: [
        async ({ page }) => {
          await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
          });
        },
      ],
      launchContext: {
        launchOptions: {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
          ],
        },
      },
    });
  }

  private buildSearchRequests(keywords: readonly Keyword[]) {
    return keywords.map((keyword) => ({
      url: `https://www.amazon.fr/s?k=${encodeURIComponent(keyword)}`,
      label: 'SEARCH',
      userData: { keyword },
    }));
  }

  private async buildKnownProductRequests(keywords: readonly Keyword[]) {
    const perKeyword = await Promise.all(
      keywords.map(async (keyword) => {
        const urls = await this.productRepository.findKnownUrlsByKeyword(
          keyword,
          KNOWN_PRODUCTS_LIMIT_PER_KEYWORD,
        );
        return urls.map((url) => ({ url, userData: { keyword } }));
      }),
    );
    return perKeyword.flat();
  }
}

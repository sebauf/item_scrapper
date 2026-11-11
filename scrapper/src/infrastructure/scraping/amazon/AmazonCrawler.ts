import { PlaywrightCrawler, createPlaywrightRouter, log, type Request } from 'crawlee';
import type { IProductRepository } from '../../../domain/product/IProductRepository.js';
import type { IScrapeFailureRepository } from '../../../domain/scrapeFailure/IScrapeFailureRepository.js';
import type { ScrapeFailureOutcome } from '../../../domain/scrapeFailure/ScrapeFailure.js';
import type { IShopScraper } from '../../../application/ports/IShopScraper.js';
import type { Keyword } from '../../../domain/keyword/Keyword.js';
import type { TrackedUrl } from '../../../domain/trackedUrl/TrackedUrl.js';
import { createAmazonSearchHandler } from './AmazonSearchHandler.js';
import { createAmazonProductHandler } from './AmazonProductHandler.js';
import { AMAZON_BROWSER_POOL_OPTIONS, requestFrenchPages } from './AmazonBrowserLocale.js';
import { PageDiagnosisError } from './AmazonPageDiagnosis.js';
import { ScrapeFailureRecorder } from '../shared/ScrapeFailureRecorder.js';

const KNOWN_PRODUCTS_LIMIT_PER_KEYWORD = 150;

export class AmazonCrawler implements IShopScraper {
  constructor(
    private readonly productRepository: IProductRepository,
    private readonly failureRepository: IScrapeFailureRepository,
  ) {}

  async scrape(keywords: readonly Keyword[], trackedUrls: readonly TrackedUrl[]): Promise<void> {
    const failures = new ScrapeFailureRecorder(
      this.failureRepository,
      log.child({ prefix: 'ScrapeFailures' }),
      'amazon',
    );
    const crawler = this.buildCrawler(failures);
    const requests = [
      ...this.buildSearchRequests(keywords),
      ...(await this.buildKnownProductRequests(keywords)),
      ...this.buildDirectProductRequests(trackedUrls),
    ];
    try {
      await crawler.run(requests);
    } finally {
      // Dernière ligne du log de la tâche Airflow : l'état du passage se lit
      // sans ouvrir la base.
      failures.logSummary();
    }
  }

  private buildCrawler(failures: ScrapeFailureRecorder): PlaywrightCrawler {
    const router = createPlaywrightRouter();
    router.addHandler('SEARCH', createAmazonSearchHandler(failures));
    router.addDefaultHandler(createAmazonProductHandler(this.productRepository, failures));

    const recordRequestFailure = (request: Request, error: Error, outcome: ScrapeFailureOutcome) =>
      failures.record({
        url: request.url,
        keyword: (request.userData as { keyword?: string }).keyword ?? null,
        pageKind: request.label === 'SEARCH' ? 'search' : 'product',
        attempt: request.retryCount + 1,
        outcome,
        ...(error instanceof PageDiagnosisError
          ? {
              reason: error.diagnosis.reason,
              detail: error.diagnosis.detail,
              evidence: error.evidence,
              html: error.html,
              keepSnapshot: error.diagnosis.keepSnapshot,
            }
          : {
              // Délai de navigation dépassé, navigateur planté, écriture en
              // base refusée… : la requête n'a pas pu être traitée.
              reason: 'request_error' as const,
              detail: error.message.split('\n')[0] ?? error.name,
              error: error.stack ?? error.message,
            }),
      });

    return new PlaywrightCrawler({
      // Le budget doit couvrir tout le catalogue à chaque exécution : les
      // écrans masquent désormais les produits que le dernier passage n'a pas
      // rafraîchis (cf. backend/src/shared/infrastructure/mongo/last-scrape.ts).
      // Un budget trop court ferait disparaître des fiches bien vivantes,
      // simplement pas relues ce jour-là.
      maxRequestsPerCrawl: parseInt(process.env.MAX_REQUESTS_PER_CRAWL ?? '1000', 10),
      maxConcurrency: 2,
      maxRequestsPerMinute: 10,
      requestHandler: router,
      // Chaque échec est classé et conservé (collection scrape_failures) :
      // `errorHandler` avant une nouvelle tentative, `failedRequestHandler`
      // quand Crawlee abandonne la page.
      errorHandler: ({ request }, error) => recordRequestFailure(request, error, 'retried'),
      failedRequestHandler: ({ request }, error) => recordRequestFailure(request, error, 'gave_up'),
      useSessionPool: true,
      sessionPoolOptions: {
        maxPoolSize: 10,
        sessionOptions: { maxUsageCount: 50, maxErrorScore: 3 },
      },
      // Fiches en français : sans cela, amazon.fr sert de l'anglais à
      // l'empreinte en-US par défaut de Crawlee (cf. AmazonBrowserLocale).
      browserPoolOptions: AMAZON_BROWSER_POOL_OPTIONS,
      preNavigationHooks: [
        requestFrenchPages,
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

  /**
   * URLs suivies individuellement (hors recherche par mot-clé) : requêtées
   * directement sur la page produit, routées par le handler par défaut.
   * `userData` ne porte pas de `keyword` — le handler enregistre alors
   * `keyword: null`, exactement comme pour un produit sans mot-clé source.
   */
  private buildDirectProductRequests(trackedUrls: readonly TrackedUrl[]) {
    return trackedUrls.map((url) => ({ url, userData: {} }));
  }
}

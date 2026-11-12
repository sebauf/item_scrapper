import { PlaywrightCrawler, createPlaywrightRouter } from 'crawlee';
import type { IProductRepository } from '../../../domain/product/IProductRepository.js';
import type { IShopScraper } from '../../../application/ports/IShopScraper.js';
import type { Keyword } from '../../../domain/keyword/Keyword.js';
import type { TrackedUrl } from '../../../domain/trackedUrl/TrackedUrl.js';
import { SEARCH_LABEL, amazonSearchHandler, searchUrl } from './AmazonSearchHandler.js';
import { createAmazonProductHandler } from './AmazonProductHandler.js';
import { AMAZON_CRAWLER_OPTIONS } from './AmazonCrawlerOptions.js';

/**
 * Budget de pages d'une exécution, et plafond des relectures d'un mot-clé.
 *
 * Les deux voyagent avec la règle de fraîcheur du backend
 * (backend/src/shared/infrastructure/mongo/last-scrape.ts) : les écrans
 * masquent ce que le dernier passage n'a pas relu. Le budget doit donc
 * couvrir tout le catalogue à chaque exécution, et un mot-clé de plus de
 * `KNOWN_PRODUCTS_LIMIT_PER_KEYWORD` produits verrait disparaître ceux qui ne
 * sont pas relus. Les quotas par utilisateur du backend
 * (`MAX_KEYWORDS_PER_USER`, ~155 requêtes par mot-clé au pire : ce plafond +
 * 5 pages de recherche) se calculent sur le budget.
 */
export const DEFAULT_MAX_REQUESTS_PER_CRAWL = 1000;
const KNOWN_PRODUCTS_LIMIT_PER_KEYWORD = 150;

/** Deux onglets à la fois au plus, avec l'allure de `AMAZON_CRAWLER_OPTIONS`. */
const MAX_CONCURRENCY = 2;

export class AmazonCrawler implements IShopScraper {
  constructor(
    private readonly productRepository: IProductRepository,
    private readonly maxRequestsPerCrawl: number = DEFAULT_MAX_REQUESTS_PER_CRAWL,
  ) {}

  async scrape(keywords: readonly Keyword[], trackedUrls: readonly TrackedUrl[]): Promise<void> {
    const crawler = this.buildCrawler();
    const requests = [
      ...this.buildSearchRequests(keywords),
      ...(await this.buildKnownProductRequests(keywords)),
      ...this.buildDirectProductRequests(trackedUrls),
    ];
    await crawler.run(requests);
  }

  private buildCrawler(): PlaywrightCrawler {
    const router = createPlaywrightRouter();
    router.addHandler(SEARCH_LABEL, amazonSearchHandler);
    // Toutes les fiches : résultats de recherche, produits connus, URLs
    // suivies et déclinaisons.
    router.addDefaultHandler(createAmazonProductHandler(this.productRepository));

    return new PlaywrightCrawler({
      ...AMAZON_CRAWLER_OPTIONS,
      maxRequestsPerCrawl: this.maxRequestsPerCrawl,
      maxConcurrency: MAX_CONCURRENCY,
      requestHandler: router,
    });
  }

  private buildSearchRequests(keywords: readonly Keyword[]) {
    return keywords.map((keyword) => ({
      url: searchUrl(keyword),
      label: SEARCH_LABEL,
      userData: { keyword },
    }));
  }

  /** Produits déjà connus du mot-clé, les moins récemment relus d'abord. */
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

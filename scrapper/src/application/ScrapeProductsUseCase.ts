import type { IKeywordRepository } from '../domain/keyword/IKeywordRepository.js';
import type { ITrackedUrlRepository } from '../domain/trackedUrl/ITrackedUrlRepository.js';
import type { IShopScraper } from './ports/IShopScraper.js';

export class ScrapeProductsUseCase {
  constructor(
    private readonly keywordRepository: IKeywordRepository,
    private readonly trackedUrlRepository: ITrackedUrlRepository,
    private readonly shopScraper: IShopScraper,
  ) {}

  async execute(): Promise<void> {
    const [keywords, trackedUrls] = await Promise.all([
      this.keywordRepository.findEnabled(),
      this.trackedUrlRepository.findEnabled(),
    ]);
    if (keywords.length === 0 && trackedUrls.length === 0) {
      console.warn('No enabled keywords or tracked URLs in DB, nothing to scrape.');
      return;
    }
    await this.shopScraper.scrape(keywords, trackedUrls);
  }
}

import type { IKeywordRepository } from '../domain/keyword/IKeywordRepository.js';
import type { IShopScraper } from './ports/IShopScraper.js';

export class ScrapeProductsUseCase {
  constructor(
    private readonly keywordRepository: IKeywordRepository,
    private readonly shopScraper: IShopScraper,
  ) {}

  async execute(): Promise<void> {
    const keywords = await this.keywordRepository.findEnabled();
    if (keywords.length === 0) {
      console.warn('No enabled keywords in DB, nothing to scrape.');
      return;
    }
    await this.shopScraper.scrape(keywords);
  }
}

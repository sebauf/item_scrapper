import type { Keyword } from '../../domain/keyword/Keyword.js';

export interface IShopScraper {
  scrape(keywords: readonly Keyword[]): Promise<void>;
}

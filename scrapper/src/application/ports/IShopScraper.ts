import type { Keyword } from '../../domain/keyword/Keyword.js';
import type { TrackedUrl } from '../../domain/trackedUrl/TrackedUrl.js';

export interface IShopScraper {
  scrape(keywords: readonly Keyword[], trackedUrls: readonly TrackedUrl[]): Promise<void>;
}

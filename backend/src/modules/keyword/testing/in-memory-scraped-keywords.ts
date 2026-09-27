import { ScrapedKeywords } from '../application/ports/scraped-keywords';
import { KeywordName } from '../domain/keyword-name';

/** Double de test : les mots-clés qu'`items_raw` connaîtrait. */
export class InMemoryScrapedKeywords extends ScrapedKeywords {
  private readonly scraped: Set<string>;

  constructor(scraped: readonly string[] = []) {
    super();
    this.scraped = new Set(scraped);
  }

  has(name: KeywordName): Promise<boolean> {
    return Promise.resolve(this.scraped.has(name.value));
  }
}

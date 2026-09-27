import { Inject, Injectable } from '@nestjs/common';
import { Db } from 'mongodb';
import { MONGO_DB } from 'src/shared/infrastructure/mongo/mongo.tokens';
import { ScrapedKeywords } from '../application/ports/scraped-keywords';
import { KeywordName } from '../domain/keyword-name';
import { USABLE_SCRAPE_MATCH } from './mongo-keyword-summary.read-model';

@Injectable()
export class MongoScrapedKeywords extends ScrapedKeywords {
  constructor(@Inject(MONGO_DB) private readonly db: Db) {
    super();
  }

  /**
   * Un seul document suffit à répondre. `keyword` est écrit **après** le spread
   * pour remplacer le `$ne: null` du prédicat partagé par la valeur cherchée —
   * et l'index `items_raw.keyword_day_scrapedAt` s'applique sur ce préfixe.
   */
  async has(name: KeywordName): Promise<boolean> {
    const doc = await this.db
      .collection('items_raw')
      .findOne({ ...USABLE_SCRAPE_MATCH, keyword: name.value }, { projection: { _id: 1 } });

    return doc !== null;
  }
}

import type { Db } from 'mongodb';
import type { IKeywordRepository } from '../../../domain/keyword/IKeywordRepository.js';
import { createKeyword, type Keyword } from '../../../domain/keyword/Keyword.js';

export class MongoKeywordRepository implements IKeywordRepository {
  constructor(private readonly db: Db) {}

  async findEnabled(): Promise<Keyword[]> {
    const docs = await this.db
      .collection<{ keyword: string; enabled: boolean }>('keywords')
      .find({ enabled: true })
      .toArray();
    return docs.map((d) => createKeyword(d.keyword));
  }

  async seedDefaults(keywords: readonly Keyword[]): Promise<void> {
    const count = await this.db.collection('keywords').countDocuments();
    if (count > 0) return;
    await this.db
      .collection('keywords')
      .insertMany(keywords.map((keyword) => ({ keyword, enabled: true })));
  }
}

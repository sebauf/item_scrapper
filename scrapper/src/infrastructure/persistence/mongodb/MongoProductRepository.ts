import type { Db } from 'mongodb';
import type { Product } from '../../../domain/product/Product.js';
import type { IProductRepository } from '../../../domain/product/IProductRepository.js';

const COLLECTION_ITEMS_RAW = 'items_raw';
const COLLECTION_PRICE_HISTORY = 'price_history';
const COLLECTION_DEAL_SCORES = 'deal_scores';

type PriceHistoryDoc = { _id: string; keyword: string; lastSeen: Date };
type UrlKeyedDoc = { _id: string };

function startOfDayUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export class MongoProductRepository implements IProductRepository {
  constructor(private readonly db: Db) {}

  async save(product: Product): Promise<void> {
    const day = startOfDayUtc(product.scrapedAt);
    await this.db
      .collection(COLLECTION_ITEMS_RAW)
      .updateOne({ url: product.url, day }, { $set: { ...product, day } }, { upsert: true });
  }

  async findKnownUrlsByKeyword(keyword: string, limit: number): Promise<string[]> {
    const docs = await this.db
      .collection<PriceHistoryDoc>(COLLECTION_PRICE_HISTORY)
      .find({ keyword }, { projection: { _id: 1 } })
      .sort({ lastSeen: 1 })
      .limit(limit)
      .toArray();
    return docs.map((doc) => doc._id);
  }

  async deleteByUrl(url: string): Promise<void> {
    await Promise.all([
      this.db.collection<UrlKeyedDoc>(COLLECTION_PRICE_HISTORY).deleteOne({ _id: url }),
      this.db.collection<UrlKeyedDoc>(COLLECTION_DEAL_SCORES).deleteOne({ _id: url }),
    ]);
  }
}

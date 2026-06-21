import type { Db } from 'mongodb';
import type { Product } from '../../../domain/product/Product.js';
import type { IProductRepository } from '../../../domain/product/IProductRepository.js';

function startOfDayUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export class MongoProductRepository implements IProductRepository {
  constructor(private readonly db: Db) {}

  async save(product: Product): Promise<void> {
    const day = startOfDayUtc(product.scrapedAt);
    await this.db
      .collection('items_raw')
      .updateOne({ url: product.url, day }, { $set: { ...product, day } }, { upsert: true });
  }
}

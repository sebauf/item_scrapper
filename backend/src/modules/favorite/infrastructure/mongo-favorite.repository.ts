import { Inject, Injectable } from '@nestjs/common';
import { Collection, Db } from 'mongodb';
import { MONGO_DB } from 'src/shared/infrastructure/mongo/mongo.tokens';
import { FavoriteEntry, FavoriteRepository } from '../domain/favorite.repository';

interface FavoriteDocument {
  url: string;
  addedAt: Date;
}

@Injectable()
export class MongoFavoriteRepository extends FavoriteRepository {
  constructor(@Inject(MONGO_DB) private readonly db: Db) {
    super();
  }

  private get collection(): Collection<FavoriteDocument> {
    return this.db.collection<FavoriteDocument>('favorites');
  }

  /** `$setOnInsert` : un ajout répété garde la date du premier favori. */
  async add(url: string): Promise<void> {
    await this.collection.updateOne(
      { url },
      { $setOnInsert: { url, addedAt: new Date() } },
      { upsert: true },
    );
  }

  async remove(url: string): Promise<void> {
    await this.collection.deleteOne({ url });
  }

  async isFavorite(url: string): Promise<boolean> {
    const doc = await this.collection.findOne({ url });
    return doc !== null;
  }

  async list(): Promise<FavoriteEntry[]> {
    return this.collection.find({}).sort({ addedAt: -1 }).toArray();
  }
}

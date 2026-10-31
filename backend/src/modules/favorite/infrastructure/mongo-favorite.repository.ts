import { Inject, Injectable } from '@nestjs/common';
import { Collection, Db } from 'mongodb';
import { UserId } from 'src/shared/domain/user-id';
import { MONGO_DB } from 'src/shared/infrastructure/mongo/mongo.tokens';
import { FavoriteEntry, FavoriteRepository } from '../domain/favorite.repository';

/**
 * Un document par (utilisateur, URL), unicité garantie par l'index
 * `favorites.userId_url` (cf. shared/infrastructure/mongo/indexes.ts).
 *
 * `url` garde son nom et sa forme : la purge du pipeline
 * (pipeline/src/maintenance/purge_dead_products.py) lit ce champ pour épargner
 * les favoris, quel que soit l'utilisateur.
 */
interface FavoriteDocument {
  userId: string;
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
  async add(owner: UserId, url: string): Promise<void> {
    await this.collection.updateOne(
      { userId: owner.value, url },
      { $setOnInsert: { userId: owner.value, url, addedAt: new Date() } },
      { upsert: true },
    );
  }

  async remove(owner: UserId, url: string): Promise<void> {
    await this.collection.deleteOne({ userId: owner.value, url });
  }

  async isFavorite(owner: UserId, url: string): Promise<boolean> {
    const doc = await this.collection.findOne(
      { userId: owner.value, url },
      { projection: { _id: 1 } },
    );
    return doc !== null;
  }

  async list(owner: UserId): Promise<FavoriteEntry[]> {
    const docs = await this.collection
      .find({ userId: owner.value }, { projection: { url: 1, addedAt: 1 } })
      .sort({ addedAt: -1 })
      .toArray();
    return docs.map((doc) => ({ url: doc.url, addedAt: doc.addedAt }));
  }
}

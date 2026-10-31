import { Inject, Injectable } from '@nestjs/common';
import { Collection, Db } from 'mongodb';
import { UserId } from 'src/shared/domain/user-id';
import { MONGO_DB } from 'src/shared/infrastructure/mongo/mongo.tokens';
import {
  FavoriteStationEntry,
  FavoriteStationRepository,
} from '../domain/favorite-station.repository';

/**
 * Un document par (utilisateur, station), unicité garantie par l'index
 * `favorite_stations.userId_stationId`. `_id` est laissé à Mongo.
 *
 * Avant l'authentification, `_id` était l'identifiant de la station (une seule
 * liste pour tout le monde). Ces documents historiques gardent leur `_id` —
 * immuable — et reçoivent `userId` et `stationId` lors de leur rattachement
 * (cf. shared/infrastructure/mongo/legacy-ownership.ts). Le pipeline lit
 * `stationId`, avec repli sur `_id` pour un document pas encore rattaché.
 */
interface FavoriteStationDocument {
  userId: string;
  stationId: string;
  addedAt: Date;
}

@Injectable()
export class MongoFavoriteStationRepository extends FavoriteStationRepository {
  constructor(@Inject(MONGO_DB) private readonly db: Db) {
    super();
  }

  private get collection(): Collection<FavoriteStationDocument> {
    return this.db.collection<FavoriteStationDocument>('favorite_stations');
  }

  /** `$setOnInsert` : un ajout répété garde la date du premier. */
  async add(owner: UserId, stationId: string): Promise<void> {
    await this.collection.updateOne(
      { userId: owner.value, stationId },
      { $setOnInsert: { userId: owner.value, stationId, addedAt: new Date() } },
      { upsert: true },
    );
  }

  async remove(owner: UserId, stationId: string): Promise<void> {
    await this.collection.deleteOne({ userId: owner.value, stationId });
  }

  async list(owner: UserId): Promise<FavoriteStationEntry[]> {
    const docs = await this.collection
      .find({ userId: owner.value }, { projection: { stationId: 1, addedAt: 1 } })
      .sort({ addedAt: -1 })
      .toArray();
    return docs.map((doc) => ({ stationId: doc.stationId, addedAt: doc.addedAt }));
  }
}

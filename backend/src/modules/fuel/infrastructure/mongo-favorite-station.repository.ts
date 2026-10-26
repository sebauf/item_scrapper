import { Inject, Injectable } from '@nestjs/common';
import { Collection, Db } from 'mongodb';
import { MONGO_DB } from 'src/shared/infrastructure/mongo/mongo.tokens';
import {
  FavoriteStationEntry,
  FavoriteStationRepository,
} from '../domain/favorite-station.repository';

/**
 * `_id` = identifiant officiel de la station, comme dans `fuel_stations` :
 * l'unicité est garantie sans index supplémentaire, et le pipeline lit la
 * collection sans jointure.
 */
interface FavoriteStationDocument {
  _id: string;
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
  async add(stationId: string): Promise<void> {
    await this.collection.updateOne(
      { _id: stationId },
      { $setOnInsert: { addedAt: new Date() } },
      { upsert: true },
    );
  }

  async remove(stationId: string): Promise<void> {
    await this.collection.deleteOne({ _id: stationId });
  }

  async list(): Promise<FavoriteStationEntry[]> {
    const docs = await this.collection.find({}).sort({ addedAt: -1 }).toArray();
    return docs.map((doc) => ({ stationId: doc._id, addedAt: doc.addedAt }));
  }
}

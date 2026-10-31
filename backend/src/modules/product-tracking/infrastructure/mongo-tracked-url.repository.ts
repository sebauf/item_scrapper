import { Inject, Injectable } from '@nestjs/common';
import { Collection, Db } from 'mongodb';
import { UserId } from 'src/shared/domain/user-id';
import { MONGO_DB } from 'src/shared/infrastructure/mongo/mongo.tokens';
import { subscriptionUpdate } from 'src/shared/infrastructure/mongo/subscriptions';
import { ProductUrl } from '../domain/product-url';
import { TrackedUrl } from '../domain/tracked-url';
import { TrackedUrlRepository } from '../domain/tracked-url.repository';

/**
 * Forme du document — miroir de MongoKeywordRepository, champ `url` au lieu de
 * `keyword`. `url` et `enabled` sont lus par le scrapper, `url` seul par la
 * purge du pipeline (une URL suivie n'est jamais purgée), `subscribers` par le
 * backend.
 */
export interface TrackedUrlDocument {
  url: string;
  enabled?: boolean;
  subscribers?: string[];
}

@Injectable()
export class MongoTrackedUrlRepository extends TrackedUrlRepository {
  constructor(@Inject(MONGO_DB) private readonly db: Db) {
    super();
  }

  private get collection(): Collection<TrackedUrlDocument> {
    return this.db.collection<TrackedUrlDocument>('tracked_urls');
  }

  async findByUrl(owner: UserId, url: ProductUrl): Promise<TrackedUrl | null> {
    const doc = await this.collection.findOne({ url: url.value }, { projection: { subscribers: 1 } });
    if (doc === null) return null;

    return TrackedUrl.rehydrate(owner, url, (doc.subscribers ?? []).includes(owner.value));
  }

  /** Abonnement et `enabled` écrits ensemble, cf. `subscriptionUpdate`. */
  async save(tracked: TrackedUrl): Promise<void> {
    await this.collection.updateOne(
      { url: tracked.url.value },
      subscriptionUpdate(tracked.owner.value, tracked.isTracked),
      { upsert: true },
    );
  }
}

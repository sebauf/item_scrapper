import { Inject, Injectable } from '@nestjs/common';
import { Collection, Db } from 'mongodb';
import { MONGO_DB } from 'src/shared/infrastructure/mongo/mongo.tokens';
import { ProductUrl } from '../domain/product-url';
import { TrackedUrl } from '../domain/tracked-url';
import { TrackedUrlRepository } from '../domain/tracked-url.repository';

/** Forme du document — miroir de MongoKeywordRepository, champ `url` au lieu de `keyword`. */
interface TrackedUrlDocument {
  url: string;
  enabled?: boolean;
}

@Injectable()
export class MongoTrackedUrlRepository extends TrackedUrlRepository {
  constructor(@Inject(MONGO_DB) private readonly db: Db) {
    super();
  }

  private get collection(): Collection<TrackedUrlDocument> {
    return this.db.collection<TrackedUrlDocument>('tracked_urls');
  }

  async findByUrl(url: ProductUrl): Promise<TrackedUrl | null> {
    const doc = await this.collection.findOne({ url: url.value });
    if (doc === null) return null;

    return TrackedUrl.rehydrate(ProductUrl.create(doc.url), doc.enabled !== false);
  }

  async save(tracked: TrackedUrl): Promise<void> {
    await this.collection.updateOne(
      { url: tracked.url.value },
      { $set: { enabled: tracked.isTracked } },
      { upsert: true },
    );
  }
}

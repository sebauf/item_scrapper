import type { Db } from 'mongodb';
import type { ITrackedUrlRepository } from '../../../domain/trackedUrl/ITrackedUrlRepository.js';
import { createTrackedUrl, type TrackedUrl } from '../../../domain/trackedUrl/TrackedUrl.js';

export class MongoTrackedUrlRepository implements ITrackedUrlRepository {
  constructor(private readonly db: Db) {}

  async findEnabled(): Promise<TrackedUrl[]> {
    const docs = await this.db
      .collection<{ url: string; enabled: boolean }>('tracked_urls')
      .find({ enabled: true })
      .toArray();
    return docs.map((d) => createTrackedUrl(d.url));
  }
}

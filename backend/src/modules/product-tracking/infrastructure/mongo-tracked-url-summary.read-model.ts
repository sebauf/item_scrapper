import { Inject, Injectable } from '@nestjs/common';
import { Db } from 'mongodb';
import { UserId } from 'src/shared/domain/user-id';
import { MONGO_DB } from 'src/shared/infrastructure/mongo/mongo.tokens';
import { ProductId } from 'src/shared/domain/product-id';
import {
  TrackedUrlSummary,
  TrackedUrlSummaryReadModel,
} from '../application/ports/tracked-url-summary.read-model';
import { TrackedUrlDocument } from './mongo-tracked-url.repository';

interface RawLatestDoc {
  _id: string;
  title?: string;
  images?: string[];
  price?: { amount: number; currency: string } | null;
  scrapedAt?: Date;
}

function toMoney(value: unknown): { amount: number; currency: string } | null {
  if (value === null || typeof value !== 'object') return null;
  const { amount, currency } = value as { amount?: unknown; currency?: unknown };
  return typeof amount === 'number' && typeof currency === 'string' ? { amount, currency } : null;
}

@Injectable()
export class MongoTrackedUrlSummaryReadModel extends TrackedUrlSummaryReadModel {
  constructor(@Inject(MONGO_DB) private readonly db: Db) {
    super();
  }

  /** `{ subscribers: x }` teste l'appartenance au tableau (index multikey). */
  async listTrackedUrls(owner: UserId): Promise<string[]> {
    const docs = await this.db
      .collection<TrackedUrlDocument>('tracked_urls')
      .find({ subscribers: owner.value }, { projection: { url: 1 } })
      .toArray();
    return docs.map((doc) => doc.url);
  }

  /**
   * Miroir de MongoKeywordSummaryReadModel : les abonnements de `owner` dans
   * `tracked_urls` font autorité sur la liste, `items_raw` ne fournit que
   * l'affichage — une URL tout juste ajoutée y figure donc avec des champs
   * `null`, en attendant le prochain passage du scrapper.
   */
  async listTracked(owner: UserId): Promise<TrackedUrlSummary[]> {
    const urls = await this.listTrackedUrls(owner);
    if (urls.length === 0) return [];

    const latest = await this.db
      .collection('items_raw')
      .aggregate<RawLatestDoc>([
        { $match: { url: { $in: urls } } },
        { $sort: { day: -1, scrapedAt: -1 } },
        {
          $group: {
            _id: '$url',
            title: { $first: '$title' },
            images: { $first: '$images' },
            price: { $first: '$price' },
            scrapedAt: { $first: '$scrapedAt' },
          },
        },
      ])
      .toArray();

    const byUrl = new Map(latest.map((doc) => [doc._id, doc]));

    return urls
      .map((url) => toSummary(url, byUrl.get(url)))
      .sort((a, b) => (a.title ?? a.url).localeCompare(b.title ?? b.url, 'fr'));
  }
}

function toSummary(url: string, doc: RawLatestDoc | undefined): TrackedUrlSummary {
  return {
    id: ProductId.fromUrl(url).value,
    url,
    title: doc?.title || null,
    image: doc?.images?.[0] ?? null,
    price: toMoney(doc?.price),
    lastScrape: doc?.scrapedAt ? new Date(doc.scrapedAt).toISOString() : null,
  };
}

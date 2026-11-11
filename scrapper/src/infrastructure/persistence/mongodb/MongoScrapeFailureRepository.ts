import { gzipSync } from 'node:zlib';
import type { Db } from 'mongodb';
import type { IScrapeFailureRepository } from '../../../domain/scrapeFailure/IScrapeFailureRepository.js';
import type { ScrapeFailure } from '../../../domain/scrapeFailure/ScrapeFailure.js';

export const COLLECTION_SCRAPE_FAILURES = 'scrape_failures';
/** Durée de conservation (index TTL sur `occurredAt`, cf. MongoConnection). */
export const SCRAPE_FAILURES_RETENTION_DAYS = 30;

function startOfDayUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Un document par échec (et par tentative). Le HTML éventuel est stocké
 * compressé en gzip (`html`, Binary) : une fiche Amazon de 1,5 Mo tombe à
 * ~200 Ko. `day` reprend la convention d'`items_raw` (minuit UTC du passage)
 * pour croiser les deux collections.
 */
export class MongoScrapeFailureRepository implements IScrapeFailureRepository {
  constructor(private readonly db: Db) {}

  async record(failure: ScrapeFailure): Promise<void> {
    const { htmlSnapshot, ...rest } = failure;
    await this.db.collection(COLLECTION_SCRAPE_FAILURES).insertOne({
      ...rest,
      day: startOfDayUtc(failure.occurredAt),
      ...(htmlSnapshot ? { html: gzipSync(htmlSnapshot), htmlEncoding: 'gzip' } : {}),
    });
  }
}

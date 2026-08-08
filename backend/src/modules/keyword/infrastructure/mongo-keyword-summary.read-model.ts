import { Inject, Injectable } from '@nestjs/common';
import { Db } from 'mongodb';
import { MONGO_DB } from 'src/shared/infrastructure/mongo/mongo.tokens';
import {
  KeywordSummary,
  KeywordSummaryReadModel,
} from '../application/ports/keyword-summary.read-model';

interface RawKeywordStat {
  keyword: string;
  productCount: number;
  lastScrape?: Date;
}

@Injectable()
export class MongoKeywordSummaryReadModel extends KeywordSummaryReadModel {
  constructor(@Inject(MONGO_DB) private readonly db: Db) {
    super();
  }

  /**
   * Portage à l'identique de frontend/src/lib/queries.ts:fetchKeywordSummaries.
   *
   * Deux sources fusionnées :
   *  - la collection `keywords` (les mots-clés explicitement suivis) ;
   *  - les statistiques calculées sur `items_raw`.
   *
   * La fusion garde les mots-clés présents dans `items_raw` mais absents de
   * `keywords` : ce sont ceux scrapés avant que la collection `keywords`
   * n'existe. Sans ça, leurs produits deviendraient invisibles dans l'UI.
   */
  async listTracked(): Promise<KeywordSummary[]> {
    const [rawStats, trackedDocs] = await Promise.all([
      this.db
        .collection('items_raw')
        .aggregate<RawKeywordStat>([
          { $match: { keyword: { $ne: null }, title: { $ne: '' }, price: { $ne: null } } },
          {
            $group: {
              _id: '$keyword',
              urls: { $addToSet: '$url' },
              lastScrape: { $max: '$scrapedAt' },
            },
          },
          {
            $project: {
              _id: 0,
              keyword: '$_id',
              productCount: { $size: '$urls' },
              lastScrape: 1,
            },
          },
        ])
        .toArray(),
      this.db
        .collection<{ keyword: string; enabled: boolean }>('keywords')
        .find({ enabled: true })
        .toArray(),
    ]);

    const statsByKeyword = new Map(rawStats.map((stat) => [stat.keyword, stat]));
    const summaries: KeywordSummary[] = [];
    const seen = new Set<string>();

    for (const doc of trackedDocs) {
      seen.add(doc.keyword);
      summaries.push(toSummary(doc.keyword, statsByKeyword.get(doc.keyword)));
    }

    for (const stat of rawStats) {
      if (!seen.has(stat.keyword)) summaries.push(toSummary(stat.keyword, stat));
    }

    return summaries.sort((a, b) => a.keyword.localeCompare(b.keyword, 'fr'));
  }
}

function toSummary(keyword: string, stat: RawKeywordStat | undefined): KeywordSummary {
  return {
    keyword,
    productCount: stat?.productCount ?? 0,
    lastScrape: stat?.lastScrape ? new Date(stat.lastScrape).toISOString() : null,
  };
}

import { Inject, Injectable } from '@nestjs/common';
import { Db } from 'mongodb';
import { MONGO_DB } from 'src/shared/infrastructure/mongo/mongo.tokens';
import { findLastScrapeDay, onlyLastScrape } from 'src/shared/infrastructure/mongo/last-scrape';
import {
  KeywordSummary,
  KeywordSummaryReadModel,
} from '../application/ports/keyword-summary.read-model';

interface RawKeywordStat {
  keyword: string;
  productCount: number;
  lastScrape?: Date;
}

interface StatsFacet {
  fresh: { _id: string; productCount: number }[];
  seen: { _id: string; lastScrape?: Date }[];
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
    const lastScrapeDay = await findLastScrapeDay(this.db);

    const [statsFacet, trackedDocs] = await Promise.all([
      this.db
        .collection('items_raw')
        .aggregate<StatsFacet>([
          { $match: { keyword: { $ne: null }, title: { $ne: '' }, price: { $ne: null } } },
          {
            // Deux comptages sur des périmètres différents, en une passe.
            // `productCount` ne compte que le dernier passage — c'est le nombre
            // de produits que la grille du mot-clé affichera. `lastScrape`,
            // lui, reste calculé sur tout l'historique : un mot-clé dont aucun
            // produit n'a survécu au dernier passage a bien été scrapé un jour,
            // et afficher « jamais scrapé » serait faux.
            $facet: {
              fresh: [
                { $match: onlyLastScrape({}, lastScrapeDay) },
                { $group: { _id: '$keyword', productCount: { $sum: 1 } } },
              ],
              seen: [{ $group: { _id: '$keyword', lastScrape: { $max: '$scrapedAt' } } }],
            },
          },
        ])
        .toArray(),
      this.db
        .collection<{ keyword: string; enabled: boolean }>('keywords')
        .find({ enabled: true })
        .toArray(),
    ]);

    const rawStats = toKeywordStats(statsFacet[0]);
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

/**
 * Recolle les deux périmètres du $facet. On part de `seen` : un mot-clé déjà
 * scrapé doit figurer dans la liste même si le dernier passage ne lui a laissé
 * aucun produit — avec `productCount: 0`, qui est alors la vérité affichable.
 */
function toKeywordStats(facet: StatsFacet | undefined): RawKeywordStat[] {
  if (!facet) return [];
  const freshCounts = new Map(facet.fresh.map((row) => [row._id, row.productCount]));

  return facet.seen.map((row) => ({
    keyword: row._id,
    productCount: freshCounts.get(row._id) ?? 0,
    lastScrape: row.lastScrape,
  }));
}

function toSummary(keyword: string, stat: RawKeywordStat | undefined): KeywordSummary {
  return {
    keyword,
    productCount: stat?.productCount ?? 0,
    lastScrape: stat?.lastScrape ? new Date(stat.lastScrape).toISOString() : null,
  };
}

import { Inject, Injectable } from '@nestjs/common';
import { Db } from 'mongodb';
import { UserId } from 'src/shared/domain/user-id';
import { MONGO_DB } from 'src/shared/infrastructure/mongo/mongo.tokens';
import { findLastScrapeDay, onlyLastScrape } from 'src/shared/infrastructure/mongo/last-scrape';
import {
  KeywordSummary,
  KeywordSummaryReadModel,
} from '../application/ports/keyword-summary.read-model';
import { KeywordDocument } from './mongo-keyword.repository';

export interface RawKeywordStat {
  keyword: string;
  productCount: number;
  lastScrape?: Date;
}

/**
 * Un relevé « exploitable » : celui que les écrans savent afficher. Un document
 * d'`items_raw` sans titre ou sans prix est un scrape raté, il ne prouve pas
 * qu'un mot-clé a des produits.
 */
export const USABLE_SCRAPE_MATCH = {
  title: { $ne: '' },
  price: { $ne: null },
} as const;

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
   * Les abonnements de `owner` (la collection `keywords` fait autorité sur la
   * liste), habillés des statistiques d'`items_raw` — calculées sur ces seuls
   * mots-clés, pas sur tout le catalogue.
   */
  async listTracked(owner: UserId): Promise<KeywordSummary[]> {
    const names = await this.listTrackedNames(owner);
    if (names.length === 0) return [];

    const lastScrapeDay = await findLastScrapeDay(this.db);
    const [facet] = await this.db
      .collection('items_raw')
      .aggregate<StatsFacet>([
        { $match: { ...USABLE_SCRAPE_MATCH, keyword: { $in: names } } },
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
      .toArray();

    return mergeKeywordSummaries(names, toKeywordStats(facet));
  }

  /**
   * Le multikey index `keywords.subscribers` (cf. shared/infrastructure/mongo/
   * indexes.ts) sert ce filtre : `{ subscribers: x }` sur un tableau teste
   * l'appartenance.
   */
  async listTrackedNames(owner: UserId): Promise<string[]> {
    const docs = await this.db
      .collection<KeywordDocument>('keywords')
      .find({ subscribers: owner.value }, { projection: { keyword: 1 } })
      .toArray();

    return docs.map((doc) => doc.keyword).sort(frenchOrder);
  }
}

function frenchOrder(a: string, b: string): number {
  return a.localeCompare(b, 'fr');
}

/**
 * Un résumé par mot-clé suivi, qu'il ait ou non des relevés : un mot-clé tout
 * juste ajouté s'affiche avec `productCount: 0` et `lastScrape: null` en
 * attendant le prochain passage du scrapper.
 */
export function mergeKeywordSummaries(
  names: readonly string[],
  stats: readonly RawKeywordStat[],
): KeywordSummary[] {
  const statsByKeyword = new Map(stats.map((stat) => [stat.keyword, stat]));
  return [...names].sort(frenchOrder).map((keyword) => toSummary(keyword, statsByKeyword.get(keyword)));
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

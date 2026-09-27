import { Inject, Injectable } from '@nestjs/common';
import { Db } from 'mongodb';
import { MONGO_DB } from 'src/shared/infrastructure/mongo/mongo.tokens';
import { findLastScrapeDay, onlyLastScrape } from 'src/shared/infrastructure/mongo/last-scrape';
import {
  KeywordSummary,
  KeywordSummaryReadModel,
} from '../application/ports/keyword-summary.read-model';

export interface RawKeywordStat {
  keyword: string;
  productCount: number;
  lastScrape?: Date;
}

/** Document de `keywords`. `enabled` peut manquer sur les lignes historiques. */
export interface KeywordDocument {
  keyword: string;
  enabled?: boolean;
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
   * Deux sources fusionnées, cf. `mergeKeywordSummaries` pour la règle :
   *  - la collection `keywords` ;
   *  - les statistiques calculées sur `items_raw`.
   *
   * La collection `keywords` est lue **sans filtre** : les documents
   * `enabled: false` ne s'affichent pas, mais la fusion a besoin de les
   * connaître pour ne pas les ressusciter depuis `items_raw`.
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
        .collection<KeywordDocument>('keywords')
        .find({}, { projection: { keyword: 1, enabled: 1 } })
        .toArray(),
    ]);

    return mergeKeywordSummaries(trackedDocs, toKeywordStats(statsFacet[0]));
  }

  /**
   * Même règle que `listTracked`, sans les statistiques : le tableau de bord
   * n'affiche qu'un nombre. Il passe donc par `distinct` plutôt que par le
   * `$facet` — même ensemble de mots-clés, sans le comptage de produits ni le
   * `$max` sur `scrapedAt` dont la page d'accueil n'a que faire.
   *
   * Le `$match` reproduit exactement celui de `listTracked` : un mot-clé dont
   * aucun relevé n'est exploitable ne doit pas être compté ici et absent
   * là-bas.
   */
  async countTracked(): Promise<number> {
    const [keywordDocs, scrapedKeywords] = await Promise.all([
      this.db
        .collection<KeywordDocument>('keywords')
        .find({}, { projection: { keyword: 1, enabled: 1 } })
        .toArray(),
      this.db
        .collection('items_raw')
        .distinct('keyword', { keyword: { $ne: null }, title: { $ne: '' }, price: { $ne: null } }),
    ]);

    return trackedKeywordNames(keywordDocs, scrapedKeywords as string[]).length;
  }
}

/**
 * La règle, et le seul endroit où elle est écrite : quels mots-clés l'UI
 * présente comme suivis.
 *
 * Trois cas, et c'est le troisième qui porte toute la subtilité :
 *
 * 1. document `enabled: true` → affiché. C'est le prédicat du scrapper
 *    (`MongoKeywordRepository.findEnabled`), donc exactement l'ensemble de ce
 *    qui sera relevé au prochain run — ce que la page promet.
 * 2. aucun document, mais des relevés dans `items_raw` → affiché. Ce sont les
 *    mots-clés scrapés avant que la collection `keywords` n'existe ; sans ça
 *    leurs produits deviendraient inatteignables depuis l'UI.
 * 3. document non `enabled: true`, avec des relevés → **masqué**. La version
 *    précédente ne connaissait que les documents `enabled: true`, si bien qu'un
 *    mot-clé retiré n'était plus « connu » et que le cas 2 le remettait dans la
 *    liste à partir de ses anciens relevés. Il y restait, badgé « En attente »
 *    et jamais rafraîchi, jusqu'à ce que la purge efface ses produits une
 *    quinzaine de jours plus tard. Retirer un mot-clé pose `enabled: false` et
 *    ne supprime pas la ligne (cf. l'agrégat `Keyword`) : il faut donc regarder
 *    tous les documents, pas les suivis.
 */
export function trackedKeywordNames(
  keywordDocs: readonly KeywordDocument[],
  scrapedKeywords: readonly string[],
): string[] {
  const documented = new Set(keywordDocs.map((doc) => doc.keyword));

  const names = keywordDocs.filter((doc) => doc.enabled === true).map((doc) => doc.keyword);
  for (const keyword of scrapedKeywords) {
    if (!documented.has(keyword)) names.push(keyword);
  }

  return names.sort((a, b) => a.localeCompare(b, 'fr'));
}

/**
 * Habille la règle de `trackedKeywordNames` des statistiques d'`items_raw`.
 * Le compteur du tableau de bord applique la même règle sur la même source —
 * c'est ce qui garantit qu'il annonce le nombre de lignes que la page liste.
 */
export function mergeKeywordSummaries(
  keywordDocs: readonly KeywordDocument[],
  stats: readonly RawKeywordStat[],
): KeywordSummary[] {
  const statsByKeyword = new Map(stats.map((stat) => [stat.keyword, stat]));

  return trackedKeywordNames(
    keywordDocs,
    stats.map((stat) => stat.keyword),
  ).map((keyword) => toSummary(keyword, statsByKeyword.get(keyword)));
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

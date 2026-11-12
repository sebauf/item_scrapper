import { Inject, Injectable } from '@nestjs/common';
import { Db, Document } from 'mongodb';
import { UserId } from 'src/shared/domain/user-id';
import { MONGO_DB } from 'src/shared/infrastructure/mongo/mongo.tokens';
import { KeywordSummaryReadModel } from 'src/modules/keyword/application/ports/keyword-summary.read-model';
import { TrackedUrlSummaryReadModel } from 'src/modules/product-tracking/application/ports/tracked-url-summary.read-model';
import { findLastScrapeDay, onlyLastScrape } from 'src/shared/infrastructure/mongo/last-scrape';
import { DEAL_SCORE_THRESHOLD } from '../domain/deal-policy';
import {
  DashboardReadModel,
  DashboardSnapshot,
  KeywordDeals,
} from '../application/ports/dashboard.read-model';
import { ProductSummary } from '../application/ports/product.read-model';
import { latestPerUrlStages } from './aggregation-stages';
import { toIso, toProductSummary } from './product.mapper';

/** Nombre de bonnes affaires mises en avant par mot-clé sur le tableau de bord. */
const DEALS_SHOWN_PER_KEYWORD = 3;

@Injectable()
export class MongoDashboardReadModel extends DashboardReadModel {
  constructor(
    @Inject(MONGO_DB) private readonly db: Db,
    private readonly keywords: KeywordSummaryReadModel,
    private readonly trackedUrls: TrackedUrlSummaryReadModel,
  ) {
    super();
  }

  /**
   * Tous les compteurs sont comptés sur le **dernier passage du scrapper**, et
   * pas sur l'historique : afficher « 1300 produits » alors que les grilles
   * n'en montrent que les 900 encore en ligne serait un écart inexplicable
   * pour qui lit l'écran. `lastUpdate` reste la seule date de l'historique —
   * c'est justement la fraîcheur du pipeline qu'elle annonce.
   *
   * Tout est restreint au **périmètre de l'utilisateur** : les produits
   * relevés pour ses mots-clés, plus ses URLs suivies à l'unité (`keyword:
   * null` dans `items_raw`, ou relevées sous le mot-clé d'un autre). Le
   * catalogue est commun, mais un compteur qui inclurait les mots-clés des
   * autres annoncerait des produits que cet utilisateur ne voit nulle part.
   *
   * Les deux listes viennent des contextes qui les possèdent (Keyword,
   * ProductTracking) et non d'une requête recopiée ici : cet écran doit parler
   * des mêmes mots-clés et URLs que les pages qui les listent.
   *
   * Quatre requêtes lancées en parallèle, après la lecture du périmètre et du
   * jour de référence. Le filtre sur `day` les cantonne à la tranche du jour,
   * servie par l'index `items_raw.day_desc`.
   */
  async load(owner: UserId): Promise<DashboardSnapshot> {
    const [trackedKeywords, trackedUrls, lastScrapeDay] = await Promise.all([
      this.keywords.listTrackedNames(owner),
      this.trackedUrls.listTrackedUrls(owner),
      findLastScrapeDay(this.db),
    ]);
    const scope = {
      $or: [{ keyword: { $in: trackedKeywords } }, { url: { $in: trackedUrls } }],
    };

    const [productCount, lastUpdate, productCounts, deals] = await Promise.all([
      this.countProducts(scope, lastScrapeDay),
      this.findLastUpdate(),
      this.countProductsByKeyword(trackedKeywords, lastScrapeDay),
      this.findDeals(scope, lastScrapeDay),
    ]);

    return {
      keywordCount: trackedKeywords.length,
      productCount,
      // Compté sur les lignes ramenées plutôt que sur `deal_scores` : le
      // pipeline peut garder le score d'un produit disparu depuis (il ne
      // repasse qu'après le scrape), et ce score ne doit pas gonfler un
      // compteur dont les grilles ne montrent aucune contrepartie.
      dealCount: deals.length,
      lastUpdate,
      dealsByKeyword: keywordDealBlocks(trackedKeywords, productCounts, deals),
    };
  }

  /**
   * `items_raw` est unique par (url, jour) : sur une seule journée, un
   * document = un produit, et countDocuments suffit.
   */
  private countProducts(scope: Document, lastScrapeDay: Date | null): Promise<number> {
    return this.db
      .collection('items_raw')
      .countDocuments(
        onlyLastScrape({ title: { $ne: '' }, price: { $ne: null }, ...scope }, lastScrapeDay),
      );
  }

  /** Dernière exécution du pipeline. */
  private async findLastUpdate(): Promise<string | null> {
    const doc = await this.db
      .collection('price_history')
      .findOne({}, { sort: { updatedAt: -1 }, projection: { updatedAt: 1 } });
    return doc?.updatedAt ? toIso(doc.updatedAt) : null;
  }

  private countProductsByKeyword(
    trackedKeywords: string[],
    lastScrapeDay: Date | null,
  ): Promise<KeywordProductCount[]> {
    return this.db
      .collection('items_raw')
      .aggregate<KeywordProductCount>([
        {
          $match: onlyLastScrape(
            {
              keyword: { $in: trackedKeywords },
              title: { $ne: '' },
              price: { $ne: null },
            },
            lastScrapeDay,
          ),
        },
        { $group: { _id: '$keyword', productCount: { $sum: 1 } } },
        { $project: { keyword: '$_id', productCount: 1 } },
      ])
      .toArray();
  }

  /**
   * Toutes les bonnes affaires du périmètre, y compris celles des URLs suivies
   * à l'unité, qui comptent dans le compteur ; de la meilleure à la moins
   * bonne. Le regroupement par mot-clé, lui, ne garde que les mots-clés suivis.
   */
  private async findDeals(scope: Document, lastScrapeDay: Date | null): Promise<ProductSummary[]> {
    const docs = await this.db
      .collection('items_raw')
      .aggregate([
        ...latestPerUrlStages(scope, lastScrapeDay),
        {
          $lookup: {
            from: 'deal_scores',
            localField: 'url',
            foreignField: '_id',
            as: 'score',
          },
        },
        // Jointure interne assumée : seules les bonnes affaires nous
        // intéressent ici, un produit sans score n'a rien à y faire.
        { $unwind: '$score' },
        { $match: { 'score.score': { $gte: DEAL_SCORE_THRESHOLD } } },
        {
          $addFields: {
            dealScore: '$score.score',
            predictedPrice: '$score.predictedPrice',
            trendDirection: '$score.trendDirection',
          },
        },
        { $project: { score: 0 } },
        { $sort: { dealScore: -1 } },
      ])
      .toArray();
    return docs.map(toProductSummary);
  }
}

interface KeywordProductCount {
  keyword: string;
  productCount: number;
}

/**
 * Les blocs « bonnes affaires » du tableau de bord : un par mot-clé suivi qui
 * a des produits au dernier passage, ses `DEALS_SHOWN_PER_KEYWORD` meilleures
 * affaires, les blocs les plus fournis d'abord.
 *
 * On part des mots-clés ayant des produits — un mot-clé sans bonne affaire
 * doit apparaître (bloc « aucune affaire aujourd'hui »), pas disparaître.
 *
 * Filtré sur les mots-clés suivis, car `items_raw` en sait trop : une URL
 * suivie à l'unité peut avoir été relevée sous le mot-clé d'un autre
 * utilisateur, et ce mot-clé n'a pas à avoir de bloc ici. Le compteur et ces
 * blocs viennent du même ensemble : impossible qu'ils se contredisent.
 *
 * @param deals bonnes affaires, de la meilleure à la moins bonne
 */
export function keywordDealBlocks(
  trackedKeywords: readonly string[],
  productCounts: readonly KeywordProductCount[],
  deals: readonly ProductSummary[],
): KeywordDeals[] {
  const tracked = new Set(trackedKeywords);
  const dealsByKeyword = new Map<string, ProductSummary[]>();
  for (const deal of deals) {
    if (deal.keyword === null) continue;
    dealsByKeyword.set(deal.keyword, [...(dealsByKeyword.get(deal.keyword) ?? []), deal]);
  }

  return productCounts
    .filter(({ keyword }) => tracked.has(keyword))
    .map(({ keyword, productCount }) => {
      const keywordDeals = dealsByKeyword.get(keyword) ?? [];
      return {
        keyword,
        productCount,
        totalDeals: keywordDeals.length,
        deals: keywordDeals.slice(0, DEALS_SHOWN_PER_KEYWORD),
      };
    })
    .sort((a, b) => b.totalDeals - a.totalDeals || a.keyword.localeCompare(b.keyword, 'fr'));
}

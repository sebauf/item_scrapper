import { Inject, Injectable } from '@nestjs/common';
import { Db, Document } from 'mongodb';
import { MONGO_DB } from 'src/shared/infrastructure/mongo/mongo.tokens';
import { KeywordSummaryReadModel } from 'src/modules/keyword/application/ports/keyword-summary.read-model';
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
  ) {
    super();
  }

  /**
   * Portage de frontend/src/lib/queries.ts:fetchDashboardData.
   *
   * Tous les compteurs sont comptés sur le **dernier passage du scrapper**, et
   * pas sur l'historique : afficher « 1300 produits » alors que les grilles
   * n'en montrent que les 900 encore en ligne serait un écart inexplicable
   * pour qui lit l'écran. `lastUpdate` reste la seule date de l'historique —
   * c'est justement la fraîcheur du pipeline qu'elle annonce.
   *
   * Cinq requêtes lancées en parallèle, après la lecture du jour de référence.
   * Le filtre sur `day` les rend nettement moins coûteuses qu'avant : elles ne
   * balaient plus tout `items_raw` mais la seule tranche du jour, servie par
   * l'index `items_raw.day_desc`.
   */
  async load(): Promise<DashboardSnapshot> {
    const lastScrapeDay = await findLastScrapeDay(this.db);

    const [keywordCount, productCount, lastUpdateDoc, productCountsRaw, dealsRaw] =
      await Promise.all([
        // Délégué au contexte Keyword, et non recompté ici : ce compteur doit
        // annoncer le nombre de lignes que la page « mots-clés » affiche. Le
        // `countDocuments({ enabled: true })` d'avant ignorait les mots-clés
        // hérités sans document, que cette page liste pourtant.
        this.keywords.countTracked(),
        // `items_raw` est unique par (url, jour) : sur une seule journée, un
        // document = un produit, et countDocuments suffit.
        this.db
          .collection('items_raw')
          .countDocuments(
            onlyLastScrape({ title: { $ne: '' }, price: { $ne: null } }, lastScrapeDay),
          ),
        this.db
          .collection('price_history')
          .findOne({}, { sort: { updatedAt: -1 }, projection: { updatedAt: 1 } }),
        this.db
          .collection('items_raw')
          .aggregate<{ keyword: string; productCount: number }>([
            {
              $match: onlyLastScrape(
                {
                  keyword: { $ne: null },
                  title: { $ne: '' },
                  price: { $ne: null },
                },
                lastScrapeDay,
              ),
            },
            { $group: { _id: '$keyword', productCount: { $sum: 1 } } },
            { $project: { keyword: '$_id', productCount: 1 } },
          ])
          .toArray(),
        // Sans restriction de mot-clé : ce sont toutes les bonnes affaires du
        // jour, y compris celles des URLs suivies à l'unité (`keyword: null`),
        // qui comptent dans le compteur global. Le regroupement par mot-clé,
        // lui, les écarte plus bas — elles n'appartiennent à aucun bloc.
        this.db
          .collection('items_raw')
          .aggregate([
            ...latestPerUrlStages({}, lastScrapeDay),
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
          .toArray(),
      ]);

    const productCountByKeyword = new Map(
      productCountsRaw.map((row) => [row.keyword, row.productCount]),
    );

    const dealsByKeywordMap = new Map<string, ProductSummary[]>();
    for (const doc of dealsRaw as Document[]) {
      if (doc.keyword === null || doc.keyword === undefined) continue;
      const keyword = String(doc.keyword);
      const bucket = dealsByKeywordMap.get(keyword) ?? [];
      bucket.push(toProductSummary(doc));
      dealsByKeywordMap.set(keyword, bucket);
    }

    // On part des mots-clés ayant des produits — un mot-clé sans bonne affaire
    // doit apparaître (bloc « aucune affaire aujourd'hui »), pas disparaître.
    const dealsByKeyword: KeywordDeals[] = Array.from(productCountByKeyword.keys())
      .map((keyword) => {
        const deals = dealsByKeywordMap.get(keyword) ?? [];
        return {
          keyword,
          productCount: productCountByKeyword.get(keyword) ?? 0,
          totalDeals: deals.length,
          deals: deals.slice(0, DEALS_SHOWN_PER_KEYWORD),
        };
      })
      .sort((a, b) => b.totalDeals - a.totalDeals || a.keyword.localeCompare(b.keyword, 'fr'));

    return {
      keywordCount,
      productCount,
      // Compté sur les lignes ramenées plutôt que sur `deal_scores` : le
      // pipeline peut garder le score d'un produit disparu depuis (il ne
      // repasse qu'après le scrape), et ce score ne doit pas gonfler un
      // compteur dont les grilles ne montrent aucune contrepartie.
      dealCount: dealsRaw.length,
      lastUpdate: lastUpdateDoc?.updatedAt ? toIso(lastUpdateDoc.updatedAt) : null,
      dealsByKeyword,
    };
  }
}

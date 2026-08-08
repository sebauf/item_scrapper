import { Inject, Injectable } from '@nestjs/common';
import { Db, Document } from 'mongodb';
import { MONGO_DB } from 'src/shared/infrastructure/mongo/mongo.tokens';
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
  constructor(@Inject(MONGO_DB) private readonly db: Db) {
    super();
  }

  /**
   * Portage de frontend/src/lib/queries.ts:fetchDashboardData.
   *
   * Six requêtes indépendantes lancées en parallèle. Attention : les deux
   * agrégations sur `items_raw` balaient toute la collection à chaque appel.
   * C'est acceptable au volume actuel (~1300 documents) mais c'est le premier
   * point à optimiser quand l'historique grossira — soit par un cache à TTL
   * ici, soit par une collection de statistiques entretenue par le pipeline.
   */
  async load(): Promise<DashboardSnapshot> {
    const [keywordCount, productCount, dealCount, lastUpdateDoc, productCountsRaw, dealsRaw] =
      await Promise.all([
        this.db.collection('keywords').countDocuments({ enabled: true }),
        this.db.collection('price_history').estimatedDocumentCount(),
        this.db
          .collection('deal_scores')
          .countDocuments({ score: { $gte: DEAL_SCORE_THRESHOLD } }),
        this.db
          .collection('price_history')
          .findOne({}, { sort: { updatedAt: -1 }, projection: { updatedAt: 1 } }),
        this.db
          .collection('items_raw')
          .aggregate<{ keyword: string; productCount: number }>([
            { $match: { keyword: { $ne: null }, title: { $ne: '' }, price: { $ne: null } } },
            { $group: { _id: '$keyword', urls: { $addToSet: '$url' } } },
            { $project: { keyword: '$_id', productCount: { $size: '$urls' } } },
          ])
          .toArray(),
        this.db
          .collection('items_raw')
          .aggregate([
            ...latestPerUrlStages({ keyword: { $ne: null } }),
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
      dealCount,
      lastUpdate: lastUpdateDoc?.updatedAt ? toIso(lastUpdateDoc.updatedAt) : null,
      dealsByKeyword,
    };
  }
}

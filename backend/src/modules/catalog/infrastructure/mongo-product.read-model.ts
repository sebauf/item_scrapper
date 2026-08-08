import { Inject, Injectable } from '@nestjs/common';
import { Db, Document } from 'mongodb';
import { MONGO_DB } from 'src/shared/infrastructure/mongo/mongo.tokens';
import { ProductId } from '../domain/product-id';
import { PAGE_SIZE, ProductQuery, ProductSort } from '../domain/product-query';
import {
  ProductDetail,
  ProductReadModel,
  ProductSearchResult,
} from '../application/ports/product.read-model';
import { escapeRegex, latestPerUrlStages, withDealScoreStages } from './aggregation-stages';
import { toHistoryEntries, toIso, toProductSummary } from './product.mapper';

/** Tri appliqué à la page demandée. `url` clôt chaque tri pour le rendre total. */
const SORT_SPECS: Record<ProductSort, Document> = {
  deals: { isDeal: -1, sortScore: -1, 'price.amount': 1, url: 1 },
  price_asc: { 'price.amount': 1, url: 1 },
  price_desc: { 'price.amount': -1, url: 1 },
  discount: { discountRatio: -1, url: 1 },
};

interface PriceHistoryDocument {
  _id: string;
  keyword?: string;
  shop?: string;
  title?: string;
  images?: string[];
  firstSeen?: Date | string;
  lastSeen?: Date | string;
  history?: Document[];
}

interface DealScoreDocument {
  _id: string;
  score?: number;
  predictedPrice?: number;
  trendDirection?: string;
}

@Injectable()
export class MongoProductReadModel extends ProductReadModel {
  constructor(@Inject(MONGO_DB) private readonly db: Db) {
    super();
  }

  /**
   * Portage de frontend/src/lib/queries.ts:fetchProductsPage.
   *
   * Le `$facet` est ce qui rend cette requête rentable : les trois résultats
   * (la page, le total filtré, les stats non filtrées) sont produits en une
   * seule passe sur le même jeu de documents. Les calculer séparément
   * multiplierait par trois le travail de Mongo pour un résultat identique.
   */
  async search(keyword: string, query: ProductQuery): Promise<ProductSearchResult> {
    const filterStages = MongoProductReadModel.filterStages(query);

    const [facet] = await this.db
      .collection('items_raw')
      .aggregate([
        ...latestPerUrlStages({ keyword }),
        ...withDealScoreStages(),
        {
          $facet: {
            items: [
              ...filterStages,
              { $sort: SORT_SPECS[query.sort] },
              { $skip: query.skip },
              { $limit: query.limit },
            ],
            filteredTotal: [...filterStages, { $count: 'n' }],
            // Volontairement hors des filtres : l'entête de page affiche
            // « N produits sur M », où M est le total du mot-clé.
            keywordStats: [
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  deals: { $sum: { $cond: ['$isDeal', 1, 0] } },
                },
              },
            ],
          },
        },
      ])
      .toArray();

    const total: number = facet?.filteredTotal?.[0]?.n ?? 0;
    const stats = facet?.keywordStats?.[0];

    return {
      items: ((facet?.items ?? []) as Document[]).map(toProductSummary),
      total,
      pageCount: Math.ceil(total / PAGE_SIZE),
      keywordTotal: stats?.total ?? 0,
      keywordDealCount: stats?.deals ?? 0,
    };
  }

  private static filterStages(query: ProductQuery): Document[] {
    const stages: Document[] = [];
    if (query.search !== null) {
      stages.push({ $match: { title: { $regex: escapeRegex(query.search), $options: 'i' } } });
    }
    if (query.dealsOnly) stages.push({ $match: { isDeal: true } });
    if (query.minPrice !== null) {
      stages.push({ $match: { 'price.amount': { $gte: query.minPrice } } });
    }
    if (query.maxPrice !== null) {
      stages.push({ $match: { 'price.amount': { $lte: query.maxPrice } } });
    }
    return stages;
  }

  /**
   * Portage de frontend/src/lib/queries.ts:fetchProductDetail.
   *
   * Trois sources, chacune faisant autorité sur une partie de la fiche :
   *  - `items_raw` (dernier relevé) pour les champs volatils — prix du jour,
   *    date de livraison ;
   *  - `price_history` pour l'historique et les dates de suivi ;
   *  - `deal_scores` pour le scoring.
   *
   * L'ordre des `??` traduit cette hiérarchie : le relevé le plus récent gagne,
   * l'historique sert de repli quand le produit n'a pas été revu récemment.
   */
  async findDetail(id: ProductId): Promise<ProductDetail | null> {
    const [historyDoc, scoreDoc, latestSnapshot] = await Promise.all([
      this.db.collection<PriceHistoryDocument>('price_history').findOne({ _id: id.url }),
      this.db.collection<DealScoreDocument>('deal_scores').findOne({ _id: id.url }),
      this.db
        .collection('items_raw')
        .find({ url: id.url })
        .sort({ day: -1, scrapedAt: -1 })
        .limit(1)
        .next(),
    ]);

    if (historyDoc === null && latestSnapshot === null) return null;

    const history = toHistoryEntries(historyDoc?.history);
    const lastEntry = history.length > 0 ? history[history.length - 1] : null;

    // On reconstitue un document unique avant de le passer au mapper commun,
    // pour que la fiche et la grille partagent exactement la même projection.
    const merged: Document = {
      url: id.url,
      keyword: latestSnapshot?.keyword ?? historyDoc?.keyword ?? null,
      shop: latestSnapshot?.shop ?? historyDoc?.shop ?? 'amazon',
      title: latestSnapshot?.title || historyDoc?.title || '',
      images: (latestSnapshot?.images as string[] | undefined)?.length
        ? latestSnapshot?.images
        : (historyDoc?.images ?? []),
      price: latestSnapshot?.price ?? lastEntry?.price ?? null,
      crossedOutPrice: latestSnapshot?.crossedOutPrice ?? lastEntry?.crossedOutPrice ?? null,
      unitPrice: latestSnapshot?.unitPrice ?? lastEntry?.unitPrice ?? null,
      deliveryDate: latestSnapshot?.deliveryDate ?? null,
      scrapedAt: latestSnapshot?.scrapedAt ?? lastEntry?.scrapedAt ?? historyDoc?.lastSeen ?? null,
      dealScore: scoreDoc?.score,
      predictedPrice: scoreDoc?.predictedPrice,
      trendDirection: scoreDoc?.trendDirection,
    };

    return {
      ...toProductSummary(merged),
      history,
      firstSeen: historyDoc?.firstSeen ? toIso(historyDoc.firstSeen) : null,
      lastSeen: historyDoc?.lastSeen ? toIso(historyDoc.lastSeen) : null,
    };
  }
}

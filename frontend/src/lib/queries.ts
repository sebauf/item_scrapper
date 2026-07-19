import { cache } from 'react';
import type { Document } from 'mongodb';
import { getDb } from './mongodb';
import { DEAL_SCORE_THRESHOLD, PAGE_SIZE } from './constants';
import type { ProductListParams, SortOption } from './search-params';
import type {
  KeywordSummary,
  Price,
  PriceHistoryEntry,
  Product,
  UnitPrice,
} from '@/types/product';

/**
 * Canonical "latest snapshot per product" pipeline over items_raw.
 * scrapedAt breaks ties between multiple scrapes of the same day so
 * pagination stays deterministic.
 */
function latestPerUrlStages(match: Document): Document[] {
  return [
    { $match: match },
    { $sort: { day: -1, scrapedAt: -1 } },
    { $group: { _id: '$url', doc: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$doc' } },
    { $match: { title: { $ne: '' }, price: { $ne: null } } },
  ];
}

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function toProduct(doc: Document): Product {
  return {
    ...doc,
    _id: String(doc._id),
    scrapedAt: toIso(doc.scrapedAt),
    priceHistory: [],
  } as unknown as Product;
}

function toHistoryEntries(history: Document[] | undefined): PriceHistoryEntry[] {
  return (history ?? []).map((entry) => ({
    ...entry,
    day: toIso(entry.day),
    scrapedAt: toIso(entry.scrapedAt),
  })) as PriceHistoryEntry[];
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export interface KeywordDeals {
  keyword: string;
  deals: Product[];
  totalDeals: number;
  productCount: number;
}

export interface DashboardData {
  keywordCount: number;
  productCount: number;
  dealCount: number;
  lastUpdate: string | null;
  dealsByKeyword: KeywordDeals[];
}

export async function fetchDashboardData(): Promise<DashboardData> {
  const db = await getDb();

  const [keywordCount, productCount, dealCount, lastUpdateDoc, productCountsRaw, dealsRaw] =
    await Promise.all([
      db.collection('keywords').countDocuments({ enabled: true }),
      db.collection('price_history').estimatedDocumentCount(),
      db.collection('deal_scores').countDocuments({ score: { $gte: DEAL_SCORE_THRESHOLD } }),
      db
        .collection('price_history')
        .findOne({}, { sort: { updatedAt: -1 }, projection: { updatedAt: 1 } }),
      db
        .collection('items_raw')
        .aggregate([
          { $match: { keyword: { $ne: null }, title: { $ne: '' }, price: { $ne: null } } },
          { $group: { _id: '$keyword', urls: { $addToSet: '$url' } } },
          { $project: { keyword: '$_id', productCount: { $size: '$urls' } } },
        ])
        .toArray(),
      db
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
          // Only scored deals are wanted here, so an inner join is correct
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
    productCountsRaw.map((r) => [r.keyword as string, r.productCount as number]),
  );

  const dealsByKeywordMap = new Map<string, Product[]>();
  for (const doc of dealsRaw) {
    const keyword = doc.keyword as string;
    if (!dealsByKeywordMap.has(keyword)) dealsByKeywordMap.set(keyword, []);
    dealsByKeywordMap.get(keyword)!.push(toProduct(doc));
  }

  const dealsByKeyword = Array.from(productCountByKeyword.keys())
    .map((keyword) => {
      const deals = dealsByKeywordMap.get(keyword) ?? [];
      return {
        keyword,
        productCount: productCountByKeyword.get(keyword) ?? 0,
        totalDeals: deals.length,
        deals: deals.slice(0, 3),
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

// ---------------------------------------------------------------------------
// Keywords page
// ---------------------------------------------------------------------------

type RawKeywordStat = { keyword: string; productCount: number; lastScrape?: Date };

export async function fetchKeywordSummaries(): Promise<KeywordSummary[]> {
  const db = await getDb();

  const [rawStats, keywordDocs] = await Promise.all([
    db
      .collection('items_raw')
      .aggregate([
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
    db
      .collection<{ keyword: string; enabled: boolean }>('keywords')
      .find({ enabled: true })
      .toArray(),
  ]);

  const statsByKeyword = new Map((rawStats as RawKeywordStat[]).map((s) => [s.keyword, s]));
  const seenFromDb = new Set<string>();
  const merged: KeywordSummary[] = [];

  for (const kw of keywordDocs) {
    seenFromDb.add(kw.keyword);
    const stat = statsByKeyword.get(kw.keyword);
    merged.push({
      keyword: kw.keyword,
      productCount: stat?.productCount ?? 0,
      lastScrape: stat?.lastScrape ? new Date(stat.lastScrape).toISOString() : null,
    });
  }

  // Keywords scraped before the keywords collection existed
  for (const stat of rawStats as RawKeywordStat[]) {
    if (!seenFromDb.has(stat.keyword)) {
      merged.push({
        keyword: stat.keyword,
        productCount: stat.productCount,
        lastScrape: stat.lastScrape ? new Date(stat.lastScrape).toISOString() : null,
      });
    }
  }

  return merged.sort((a, b) => a.keyword.localeCompare(b.keyword, 'fr'));
}

// ---------------------------------------------------------------------------
// Results page (server-side filter / sort / paginate)
// ---------------------------------------------------------------------------

export interface ProductPageData {
  items: Product[];
  total: number;
  pageCount: number;
  keywordTotal: number;
  keywordDealCount: number;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SORT_SPECS: Record<SortOption, Document> = {
  deals: { isDeal: -1, sortScore: -1, 'price.amount': 1, url: 1 },
  price_asc: { 'price.amount': 1, url: 1 },
  price_desc: { 'price.amount': -1, url: 1 },
  discount: { discountRatio: -1, url: 1 },
};

export async function fetchProductsPage(
  keyword: string,
  params: ProductListParams,
): Promise<ProductPageData> {
  const db = await getDb();

  const filterStages: Document[] = [];
  if (params.q) {
    filterStages.push({
      $match: { title: { $regex: escapeRegex(params.q), $options: 'i' } },
    });
  }
  if (params.deals) filterStages.push({ $match: { isDeal: true } });
  if (params.min !== undefined) filterStages.push({ $match: { 'price.amount': { $gte: params.min } } });
  if (params.max !== undefined) filterStages.push({ $match: { 'price.amount': { $lte: params.max } } });

  const [facet] = await db
    .collection('items_raw')
    .aggregate([
      ...latestPerUrlStages({ keyword }),
      {
        $lookup: {
          from: 'deal_scores',
          localField: 'url',
          foreignField: '_id',
          as: 'scoreDoc',
        },
      },
      // Left join: products without a score must survive with isDeal=false
      { $addFields: { scoreDoc: { $first: '$scoreDoc' } } },
      {
        $addFields: {
          dealScore: '$scoreDoc.score',
          predictedPrice: '$scoreDoc.predictedPrice',
          trendDirection: '$scoreDoc.trendDirection',
          isDeal: { $gte: [{ $ifNull: ['$scoreDoc.score', -1] }, DEAL_SCORE_THRESHOLD] },
          sortScore: { $ifNull: ['$scoreDoc.score', -1] },
          discountRatio: {
            $cond: [
              {
                $and: [
                  { $gt: ['$crossedOutPrice.amount', 0] },
                  { $gt: ['$price.amount', 0] },
                ],
              },
              { $subtract: [1, { $divide: ['$price.amount', '$crossedOutPrice.amount'] }] },
              0,
            ],
          },
        },
      },
      { $project: { scoreDoc: 0 } },
      {
        $facet: {
          items: [
            ...filterStages,
            { $sort: SORT_SPECS[params.sort] },
            { $skip: (params.page - 1) * PAGE_SIZE },
            { $limit: PAGE_SIZE },
          ],
          filteredTotal: [...filterStages, { $count: 'n' }],
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
    items: ((facet?.items ?? []) as Document[]).map(toProduct),
    total,
    pageCount: Math.ceil(total / PAGE_SIZE),
    keywordTotal: stats?.total ?? 0,
    keywordDealCount: stats?.deals ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Product detail
// ---------------------------------------------------------------------------

export interface ProductDetail {
  url: string;
  keyword: string | null;
  shop: string;
  title: string;
  images: string[];
  price: Price | null;
  crossedOutPrice: Price | null;
  unitPrice: UnitPrice | null;
  deliveryDate: string | null;
  dealScore?: number;
  predictedPrice?: number;
  trendDirection?: 'up' | 'down' | 'stable';
  history: PriceHistoryEntry[];
  firstSeen: string | null;
  lastSeen: string | null;
}

type PriceHistoryDoc = {
  _id: string;
  keyword?: string;
  shop?: string;
  title?: string;
  images?: string[];
  firstSeen?: Date | string;
  lastSeen?: Date | string;
  history?: Document[];
};

type DealScoreDoc = {
  _id: string;
  score?: number;
  predictedPrice?: number;
  trendDirection?: 'up' | 'down' | 'stable';
};

// cache() dedupes the page render and generateMetadata fetching the same product
export const fetchProductDetail = cache(async (url: string): Promise<ProductDetail | null> => {
  const db = await getDb();

  const [historyDoc, scoreDoc, latestSnap] = await Promise.all([
    db.collection<PriceHistoryDoc>('price_history').findOne({ _id: url }),
    db.collection<DealScoreDoc>('deal_scores').findOne({ _id: url }),
    db.collection('items_raw').find({ url }).sort({ day: -1, scrapedAt: -1 }).limit(1).next(),
  ]);

  if (!historyDoc && !latestSnap) return null;

  const history = toHistoryEntries(historyDoc?.history);
  const lastEntry = history.length > 0 ? history[history.length - 1] : null;

  return {
    url,
    keyword: (latestSnap?.keyword as string | undefined) ?? historyDoc?.keyword ?? null,
    shop: (latestSnap?.shop as string | undefined) ?? historyDoc?.shop ?? 'amazon',
    title: (latestSnap?.title as string | undefined) || historyDoc?.title || '',
    images:
      ((latestSnap?.images as string[] | undefined)?.length
        ? (latestSnap?.images as string[])
        : historyDoc?.images) ?? [],
    price: (latestSnap?.price as Price | null | undefined) ?? lastEntry?.price ?? null,
    crossedOutPrice:
      (latestSnap?.crossedOutPrice as Price | null | undefined) ??
      lastEntry?.crossedOutPrice ??
      null,
    unitPrice: (latestSnap?.unitPrice as UnitPrice | null | undefined) ?? lastEntry?.unitPrice ?? null,
    deliveryDate: (latestSnap?.deliveryDate as string | null | undefined) ?? null,
    dealScore: scoreDoc?.score,
    predictedPrice: scoreDoc?.predictedPrice,
    trendDirection: scoreDoc?.trendDirection,
    history,
    firstSeen: historyDoc?.firstSeen ? toIso(historyDoc.firstSeen) : null,
    lastSeen: historyDoc?.lastSeen ? toIso(historyDoc.lastSeen) : null,
  };
});

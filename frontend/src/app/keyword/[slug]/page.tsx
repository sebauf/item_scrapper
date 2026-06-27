import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/mongodb';
import { isGoodDeal } from '@/lib/constants';
import type { Product, PriceHistoryEntry } from '@/types/product';
import { ProductDashboard } from '@/components/ProductDashboard';

export const dynamic = 'force-dynamic';

async function getProducts(keyword: string): Promise<Product[]> {
  const db = await getDb();

  const results = await db
    .collection('items_raw')
    .aggregate([
      { $match: { keyword } },
      { $sort: { day: -1 } },
      { $group: { _id: '$url', doc: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$doc' } },
      { $match: { title: { $ne: '' }, price: { $ne: null } } },
    ])
    .toArray();

  if (results.length === 0) return [];

  const products = results.map((r) => ({
    ...r,
    _id: r._id.toString(),
    scrapedAt: r.scrapedAt instanceof Date ? r.scrapedAt.toISOString() : String(r.scrapedAt),
  })) as Product[];

  const urls = products.map((p) => p.url);

  const [scores, histories] = await Promise.all([
    db
      .collection<{ _id: string; score: number; predictedPrice: number; trendDirection?: 'down' | 'up' | 'stable' }>('deal_scores')
      .find({ _id: { $in: urls } })
      .toArray(),
    db
      .collection<{ _id: string; history: Array<{ day: string; price: { amount: number; currency: string } | null; crossedOutPrice: { amount: number; currency: string } | null; unitPrice: { amount: number; unit: string } | null; scrapedAt: Date | string }> }>('price_history')
      .find({ _id: { $in: urls } }, { projection: { history: 1 } })
      .toArray(),
  ]);

  const scoreByUrl = new Map(scores.map((s) => [s._id, s]));
  const historyByUrl = new Map(histories.map((h) => [h._id, h.history ?? []]));

  return products.map((p) => {
    const score = scoreByUrl.get(p.url);
    const priceHistory: PriceHistoryEntry[] = (historyByUrl.get(p.url) ?? []).map((entry) => ({
      ...entry,
      scrapedAt: entry.scrapedAt instanceof Date ? entry.scrapedAt.toISOString() : String(entry.scrapedAt),
    }));

    return {
      ...p,
      dealScore: score?.score,
      predictedPrice: score?.predictedPrice,
      trendDirection: score?.trendDirection,
      priceHistory,
    };
  });
}

export default async function KeywordPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const keyword = decodeURIComponent(slug);
  const products = await getProducts(keyword);

  if (products.length === 0) notFound();

  const dealCount = products.filter((p) => isGoodDeal(p.dealScore)).length;

  return (
    <main className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex items-center gap-4 mb-6">
        <Link
          href="/keywords"
          className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-700 transition-colors shrink-0"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Mots-clés
        </Link>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900 truncate capitalize">{keyword}</h1>
          <p className="text-sm text-gray-500">
            {products.length} produit{products.length !== 1 ? 's' : ''}
            {dealCount > 0 && (
              <span className="ml-2 text-emerald-600 font-medium">
                · {dealCount} bonne{dealCount > 1 ? 's' : ''} affaire{dealCount > 1 ? 's' : ''}
              </span>
            )}
          </p>
        </div>
      </div>

      <ProductDashboard products={products} />
    </main>
  );
}

import Link from 'next/link';
import { getDb } from '@/lib/mongodb';
import { DEAL_SCORE_THRESHOLD } from '@/lib/constants';
import { timeAgo } from '@/lib/format';
import type { Product } from '@/types/product';
import { ProductCard } from '@/components/ProductCard';

export const dynamic = 'force-dynamic';

interface KeywordDeals {
  keyword: string;
  deals: Product[];
  totalDeals: number;
  productCount: number;
}

interface DashboardStats {
  keywordCount: number;
  productCount: number;
  dealCount: number;
  lastUpdate: string | null;
  dealsByKeyword: KeywordDeals[];
}

async function getDashboardStats(): Promise<DashboardStats> {
  const db = await getDb();

  const [keywordCount, productCount, dealCount, lastUpdateDoc] = await Promise.all([
    db.collection('keywords').countDocuments({ enabled: true }),
    db.collection('price_history').estimatedDocumentCount(),
    db.collection('deal_scores').countDocuments({ score: { $gte: DEAL_SCORE_THRESHOLD } }),
    db.collection('price_history').findOne({}, { sort: { updatedAt: -1 }, projection: { updatedAt: 1 } }),
  ]);

  const dealsByKeyword = await fetchDealsByKeyword();

  return {
    keywordCount,
    productCount,
    dealCount,
    lastUpdate: lastUpdateDoc?.updatedAt
      ? new Date(lastUpdateDoc.updatedAt as Date).toISOString()
      : null,
    dealsByKeyword,
  };
}

async function fetchDealsByKeyword(): Promise<KeywordDeals[]> {
  const db = await getDb();

  const [productCountsRaw, dealsRaw] = await Promise.all([
    db.collection('items_raw').aggregate([
      { $match: { keyword: { $ne: null }, title: { $ne: '' }, price: { $ne: null } } },
      { $group: { _id: '$keyword', urls: { $addToSet: '$url' } } },
      { $project: { keyword: '$_id', productCount: { $size: '$urls' } } },
    ]).toArray(),

    db.collection('items_raw').aggregate([
      { $sort: { day: -1 } },
      { $group: { _id: '$url', doc: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$doc' } },
      { $match: { title: { $ne: '' }, price: { $ne: null }, keyword: { $ne: null } } },
      {
        $lookup: {
          from: 'deal_scores',
          localField: 'url',
          foreignField: '_id',
          as: 'score',
        },
      },
      { $unwind: '$score' },
      { $match: { 'score.score': { $gte: DEAL_SCORE_THRESHOLD } } },
      {
        $addFields: {
          dealScore: '$score.score',
          predictedPrice: '$score.predictedPrice',
          trendDirection: '$score.trendDirection',
        },
      },
      { $sort: { dealScore: -1 } },
    ]).toArray(),
  ]);

  const productCountByKeyword = new Map(
    productCountsRaw.map((r) => [r.keyword as string, r.productCount as number]),
  );

  const dealsByKeyword = new Map<string, Product[]>();
  for (const doc of dealsRaw) {
    const keyword = doc.keyword as string;
    if (!dealsByKeyword.has(keyword)) dealsByKeyword.set(keyword, []);
    dealsByKeyword.get(keyword)!.push({
      ...doc,
      _id: doc._id.toString(),
      scrapedAt: doc.scrapedAt instanceof Date ? doc.scrapedAt.toISOString() : String(doc.scrapedAt),
      priceHistory: [],
    } as unknown as Product);
  }

  return Array.from(productCountByKeyword.keys())
    .map((keyword) => {
      const deals = dealsByKeyword.get(keyword) ?? [];
      return {
        keyword,
        productCount: productCountByKeyword.get(keyword) ?? 0,
        totalDeals: deals.length,
        deals: deals.slice(0, 3),
      };
    })
    .sort((a, b) => b.totalDeals - a.totalDeals || a.keyword.localeCompare(b.keyword, 'fr'));
}

interface StatCardProps {
  value: number | string;
  label: string;
  icon: string;
  accent?: string;
}

function StatCard({ value, label, icon, accent = 'text-gray-900' }: StatCardProps) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 px-4 py-4 flex items-center gap-3">
      <span className="text-2xl shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className={`text-base sm:text-2xl font-bold leading-tight truncate ${accent}`}>{value}</p>
        <p className="text-xs text-gray-500 mt-0.5 truncate">{label}</p>
      </div>
    </div>
  );
}

function KeywordDealsSection({ keyword, deals, totalDeals, productCount }: KeywordDeals) {
  const hasDeals = totalDeals > 0;

  return (
    <div className={`bg-white rounded-2xl border overflow-hidden ${hasDeals ? 'border-gray-200' : 'border-gray-100'}`}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-base">{hasDeals ? '🔥' : '📦'}</span>
          <h3 className="font-semibold text-gray-900 truncate capitalize">{keyword}</h3>
          {hasDeals ? (
            <span className="shrink-0 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full">
              {totalDeals} affaire{totalDeals > 1 ? 's' : ''}
            </span>
          ) : (
            <span className="shrink-0 text-xs text-gray-400">
              {productCount} produit{productCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <Link
          href={`/keyword/${encodeURIComponent(keyword)}`}
          className="shrink-0 text-sm text-indigo-600 hover:text-indigo-800 hover:underline transition-colors ml-4"
        >
          Voir tous →
        </Link>
      </div>

      {hasDeals ? (
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {deals.map((product) => (
            <ProductCard key={product.url} product={product} />
          ))}
        </div>
      ) : (
        <p className="px-5 py-4 text-sm text-gray-400">
          Aucune bonne affaire détectée — les prix sont actuellement au-dessus de la moyenne historique.
        </p>
      )}
    </div>
  );
}

export default async function DashboardPage() {
  const { keywordCount, productCount, dealCount, lastUpdate, dealsByKeyword } =
    await getDashboardStats();

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Tableau de bord</h1>
        {lastUpdate && (
          <p className="text-sm text-gray-400 mt-1">Mis à jour {timeAgo(lastUpdate)}</p>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-10">
        <StatCard value={keywordCount} label="Mots-clés suivis" icon="🔑" />
        <StatCard value={productCount} label="Produits trackés" icon="📦" />
        <StatCard
          value={dealCount}
          label="Bonnes affaires"
          icon="🔥"
          accent={dealCount > 0 ? 'text-emerald-600' : 'text-gray-900'}
        />
        <StatCard
          value={lastUpdate ? new Date(lastUpdate).toLocaleDateString('fr-FR') : '—'}
          label="Dernier pipeline"
          icon="🕐"
        />
      </div>

      {dealsByKeyword.length > 0 ? (
        <section className="flex flex-col gap-6">
          <h2 className="text-lg font-bold text-gray-900">Récapitulatif par mot-clé</h2>
          {dealsByKeyword.map((group) => (
            <KeywordDealsSection key={group.keyword} {...group} />
          ))}
        </section>
      ) : (
        <section className="text-center py-16 bg-white rounded-2xl border border-dashed border-gray-200">
          <p className="text-4xl mb-3">📊</p>
          <p className="text-gray-500 font-medium">Aucune bonne affaire détectée pour l&apos;instant.</p>
          <p className="text-sm text-gray-400 mt-1">
            Le pipeline de scoring doit tourner au moins une fois.
          </p>
          <Link
            href="/keywords"
            className="inline-block mt-5 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
          >
            Gérer les mots-clés
          </Link>
        </section>
      )}
    </main>
  );
}

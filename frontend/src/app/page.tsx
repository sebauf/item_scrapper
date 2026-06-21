import Link from 'next/link';
import { getDb } from '@/lib/mongodb';
import type { KeywordSummary } from '@/types/product';

export const dynamic = 'force-dynamic';

async function getKeywords(): Promise<KeywordSummary[]> {
  const db = await getDb();
  const results = await db
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
      { $sort: { keyword: 1 } },
    ])
    .toArray();
  return results as KeywordSummary[];
}

export default async function HomePage() {
  const keywords = await getKeywords();

  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-bold mb-1">Price Tracker</h1>
      <p className="text-gray-500 mb-8">
        {keywords.length} keyword{keywords.length !== 1 ? 's' : ''} suivis
      </p>

      {keywords.length === 0 ? (
        <p className="text-gray-400">Aucune donnée — lance le scrapper d'abord.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {keywords.map((k) => (
            <Link
              key={k.keyword}
              href={`/keyword/${encodeURIComponent(k.keyword)}`}
              className="flex items-center justify-between px-5 py-4 rounded-xl border border-gray-200 hover:border-gray-400 hover:bg-gray-50 transition-colors"
            >
              <span className="font-medium">{k.keyword}</span>
              <div className="text-sm text-gray-500 flex gap-5">
                <span>{k.productCount} produit{k.productCount !== 1 ? 's' : ''}</span>
                <span>Scraped le {new Date(k.lastScrape).toLocaleDateString('fr-FR')}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

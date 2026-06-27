import { getDb } from '@/lib/mongodb';
import type { KeywordSummary } from '@/types/product';
import { KeywordDashboard } from '@/components/KeywordDashboard';

export const dynamic = 'force-dynamic';

type RawStat = { keyword: string; productCount: number; lastScrape?: Date };

async function getKeywords(): Promise<KeywordSummary[]> {
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

  const statsByKeyword = new Map((rawStats as RawStat[]).map((s) => [s.keyword, s]));
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
  for (const stat of rawStats as RawStat[]) {
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

export default async function KeywordsPage() {
  const keywords = await getKeywords();

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Mots-clés</h1>
        <p className="text-sm text-gray-500 mt-1">
          {keywords.length} mot{keywords.length !== 1 ? 's' : ''}-clé
          {keywords.length !== 1 ? 's' : ''} · Seront scrapés lors du prochain run Airflow
        </p>
      </div>
      <KeywordDashboard keywords={keywords} />
    </main>
  );
}

import { fetchKeywordSummaries } from '@/lib/queries';
import { KeywordDashboard } from '@/components/KeywordDashboard';

export const dynamic = 'force-dynamic';

export default async function KeywordsPage() {
  const keywords = await fetchKeywordSummaries();

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Mots-clés</h1>
        <p className="text-sm text-muted mt-1">
          {keywords.length} mot{keywords.length !== 1 ? 's' : ''}-clé
          {keywords.length !== 1 ? 's' : ''} · Seront scrapés lors du prochain run Airflow
        </p>
      </div>
      <KeywordDashboard keywords={keywords} />
    </main>
  );
}

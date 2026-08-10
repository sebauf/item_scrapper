import { getTrackedUrls } from '@/lib/api';
import { TrackedUrlDashboard } from '@/components/TrackedUrlDashboard';

export const dynamic = 'force-dynamic';

export default async function ProductsPage() {
  const trackedUrls = await getTrackedUrls();

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Suivi individuel</h1>
        <p className="text-sm text-muted mt-1">
          {trackedUrls.length} URL{trackedUrls.length !== 1 ? 's' : ''} suivie
          {trackedUrls.length !== 1 ? 's' : ''} · Seront scrapées lors du prochain run Airflow
        </p>
      </div>
      <TrackedUrlDashboard trackedUrls={trackedUrls} />
    </main>
  );
}

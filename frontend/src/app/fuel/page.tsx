import { searchFuelStations } from '@/lib/api';
import { buildFuelApiQuery, parseFuelSearchParams } from '@/lib/fuel';
import { FuelExplorer } from '@/components/FuelExplorer';

export const dynamic = 'force-dynamic';

export default async function FuelPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Lecture indulgente de l'URL, puis requête normalisée vers l'API stricte
  // (même partage des rôles que la liste de produits, cf. search-params.ts).
  const params = parseFuelSearchParams(await searchParams);
  const result = await searchFuelStations(buildFuelApiQuery(params));

  return (
    <main className="max-w-7xl mx-auto px-4 py-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-foreground">Carburants</h1>
        <p className="text-sm text-muted mt-1">
          Prix déclarés par les stations au ministère de l’Économie (flux officiel, mis à jour 3 fois
          par jour).
        </p>
      </div>
      <FuelExplorer params={params} result={result} />
    </main>
  );
}

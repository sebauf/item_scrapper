import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { searchProducts } from '@/lib/api';
import {
  buildQueryString,
  hasActiveFilters,
  parseProductListParams,
} from '@/lib/search-params';
import { ProductCard } from '@/components/ProductCard';
import { ProductFilters } from '@/components/ProductFilters';
import { Pagination } from '@/components/Pagination';

export const dynamic = 'force-dynamic';

export default async function KeywordPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;

  let keyword: string;
  try {
    keyword = decodeURIComponent(slug);
  } catch {
    notFound();
  }

  // parseProductListParams reste indulgent : il lit une URL tapée par un humain
  // et retombe sur les valeurs par défaut. buildQueryString le renormalise
  // ensuite pour l'API, qui, elle, refuse toute valeur aberrante.
  const listParams = parseProductListParams(await searchParams);
  const data = await searchProducts(keyword, buildQueryString(listParams));

  if (data.keywordTotal === 0) notFound();

  const basePath = `/keyword/${encodeURIComponent(keyword)}`;
  if (data.pageCount > 0 && listParams.page > data.pageCount) {
    redirect(basePath + buildQueryString({ ...listParams, page: data.pageCount }));
  }

  const filtered = hasActiveFilters(listParams);

  return (
    <main className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex items-center gap-4 mb-6">
        <Link
          href="/keywords"
          className="flex items-center gap-1 text-sm text-faint hover:text-foreground transition-colors shrink-0"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Mots-clés
        </Link>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-foreground truncate capitalize">{keyword}</h1>
          <p className="text-sm text-muted">
            {data.keywordTotal} produit{data.keywordTotal !== 1 ? 's' : ''}
            {data.keywordDealCount > 0 && (
              <span className="ml-2 text-deal font-medium">
                · {data.keywordDealCount} bonne{data.keywordDealCount > 1 ? 's' : ''} affaire
                {data.keywordDealCount > 1 ? 's' : ''}
              </span>
            )}
          </p>
        </div>
      </div>

      <ProductFilters params={listParams} dealCount={data.keywordDealCount} />

      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted">
          <span className="font-semibold text-foreground">{data.total}</span> produit
          {data.total !== 1 ? 's' : ''}
          {filtered && <span className="text-faint"> sur {data.keywordTotal}</span>}
        </p>
        {filtered && (
          <Link
            href={basePath}
            className="text-xs text-accent hover:text-accent-hover hover:underline transition-colors"
          >
            Réinitialiser les filtres
          </Link>
        )}
      </div>

      {data.items.length === 0 ? (
        <div className="text-center py-24 text-faint">
          <p className="text-5xl mb-4">🔍</p>
          <p className="text-base">Aucun produit ne correspond aux filtres.</p>
          <Link
            href={basePath}
            className="inline-block mt-4 text-sm text-accent hover:underline"
          >
            Réinitialiser
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {data.items.map((p) => (
              <ProductCard key={p.url} product={p} />
            ))}
          </div>
          <Pagination basePath={basePath} params={listParams} pageCount={data.pageCount} />
        </>
      )}
    </main>
  );
}

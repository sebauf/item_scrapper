'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  buildQueryString,
  type ProductListParams,
  type SortOption,
} from '@/lib/search-params';

const DEBOUNCE_MS = 350;

export function ProductFilters({
  params,
  dealCount,
}: {
  params: ProductListParams;
  dealCount: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const [search, setSearch] = useState(params.q);
  const [minPrice, setMinPrice] = useState(params.min?.toString() ?? '');
  const [maxPrice, setMaxPrice] = useState(params.max?.toString() ?? '');
  const [showAdvanced, setShowAdvanced] = useState(
    params.min !== undefined || params.max !== undefined,
  );
  // Tracks whether the last URL change was ours (debounced inputs) or external
  // (reset link, back button) — external changes must overwrite local state.
  const selfNavigated = useRef(false);

  function navigate(next: Partial<ProductListParams>, opts?: { push?: boolean }) {
    selfNavigated.current = true;
    const qs = buildQueryString({ ...params, page: undefined, ...next });
    startTransition(() => {
      if (opts?.push) router.push(pathname + qs, { scroll: false });
      else router.replace(pathname + qs, { scroll: false });
    });
  }

  function parsedInput(raw: string): number | undefined {
    const n = parseFloat(raw);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  }

  // Debounced navigation for text/number inputs
  useEffect(() => {
    const min = parsedInput(minPrice);
    const max = parsedInput(maxPrice);
    const q = search.trim().slice(0, 100);
    if (q === params.q && min === params.min && max === params.max) return;

    const timer = setTimeout(() => navigate({ q, min, max }), DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, minPrice, maxPrice]);

  // Adopt external URL changes (reset link, history navigation)
  useEffect(() => {
    if (selfNavigated.current) {
      selfNavigated.current = false;
      return;
    }
    setSearch(params.q);
    setMinPrice(params.min?.toString() ?? '');
    setMaxPrice(params.max?.toString() ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.q, params.min, params.max]);

  return (
    /* sticky top-14 offsets the fixed header (h-14 = 56px) */
    <div className="sticky top-14 z-10 bg-surface/95 backdrop-blur-sm border-b border-border-subtle -mx-4 px-4 py-3 mb-6 shadow-sm">
      <div className="flex gap-2 items-center flex-wrap sm:flex-nowrap">
        <div className="relative basis-full sm:basis-auto sm:flex-1 min-w-0">
          {isPending ? (
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-accent animate-spin pointer-events-none"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" strokeWidth={3} />
              <path className="opacity-90" strokeWidth={3} strokeLinecap="round" d="M12 2a10 10 0 019.5 6.9" />
            </svg>
          ) : (
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-faint pointer-events-none"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          )}
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filtrer les produits…"
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-border bg-surface focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft text-sm transition-shadow"
          />
        </div>

        {dealCount > 0 && (
          <button
            onClick={() => navigate({ deals: !params.deals })}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-all whitespace-nowrap ${
              params.deals
                ? 'bg-deal-strong text-white shadow-sm'
                : 'border border-border text-muted hover:border-deal-border hover:text-deal hover:bg-deal-soft/40'
            }`}
          >
            <span>🔥</span>
            <span>
              {dealCount}
              <span className="hidden sm:inline"> affaire{dealCount > 1 ? 's' : ''}</span>
            </span>
          </button>
        )}

        <select
          value={params.sort}
          onChange={(e) => navigate({ sort: e.target.value as SortOption }, { push: true })}
          className="px-3 py-2 rounded-xl border border-border text-sm text-muted bg-surface focus:outline-none focus:border-accent cursor-pointer whitespace-nowrap"
        >
          <option value="deals">Meilleures affaires</option>
          <option value="price_asc">Prix croissant</option>
          <option value="price_desc">Prix décroissant</option>
          <option value="discount">Remise %</option>
        </select>

        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className={`p-2 rounded-xl border transition-colors ${
            showAdvanced || minPrice || maxPrice
              ? 'border-accent/40 bg-accent-soft text-accent'
              : 'border-border text-faint hover:text-muted hover:border-ghost'
          }`}
          title="Filtres par prix"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
          </svg>
        </button>
      </div>

      {showAdvanced && (
        <div className="flex items-center gap-2 mt-2.5 flex-wrap">
          <span className="text-xs text-muted font-medium">Prix :</span>
          <input
            type="number"
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
            placeholder="Min €"
            min="0"
            className="w-24 px-2.5 py-1.5 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent-soft"
          />
          <span className="text-ghost text-sm">—</span>
          <input
            type="number"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            placeholder="Max €"
            min="0"
            className="w-24 px-2.5 py-1.5 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent-soft"
          />
          {(minPrice || maxPrice) && (
            <button
              onClick={() => {
                setMinPrice('');
                setMaxPrice('');
              }}
              className="text-xs text-danger hover:underline transition-colors"
            >
              Effacer
            </button>
          )}
        </div>
      )}
    </div>
  );
}

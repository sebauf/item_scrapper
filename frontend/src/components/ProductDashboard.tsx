'use client';
import { useState, useMemo } from 'react';
import type { Product } from '@/types/product';
import { DEAL_SCORE_THRESHOLD, isGoodDeal } from '@/lib/constants';
import { ProductCard } from './ProductCard';

type SortOption = 'deals' | 'price_asc' | 'price_desc' | 'discount';

function sortProducts(products: Product[], sort: SortOption): Product[] {
  return [...products].sort((a, b) => {
    switch (sort) {
      case 'deals': {
        const aHasDeal = isGoodDeal(a.dealScore);
        const bHasDeal = isGoodDeal(b.dealScore);
        if (aHasDeal !== bHasDeal) return aHasDeal ? -1 : 1;
        if (aHasDeal && bHasDeal) return (b.dealScore ?? 0) - (a.dealScore ?? 0);
        return (a.price?.amount ?? Infinity) - (b.price?.amount ?? Infinity);
      }
      case 'price_asc':
        return (a.price?.amount ?? Infinity) - (b.price?.amount ?? Infinity);
      case 'price_desc':
        return (b.price?.amount ?? 0) - (a.price?.amount ?? 0);
      case 'discount': {
        const aDisc = a.crossedOutPrice && a.price ? 1 - a.price.amount / a.crossedOutPrice.amount : 0;
        const bDisc = b.crossedOutPrice && b.price ? 1 - b.price.amount / b.crossedOutPrice.amount : 0;
        return bDisc - aDisc;
      }
      default:
        return 0;
    }
  });
}

function applyFilters(
  products: Product[],
  search: string,
  dealsOnly: boolean,
  minPrice: string,
  maxPrice: string,
): Product[] {
  let result = products;

  if (search.trim()) {
    const query = search.toLowerCase();
    result = result.filter((p) => p.title.toLowerCase().includes(query));
  }

  if (dealsOnly) {
    result = result.filter((p) => isGoodDeal(p.dealScore));
  }

  const min = parseFloat(minPrice);
  const max = parseFloat(maxPrice);
  if (!isNaN(min)) result = result.filter((p) => p.price && p.price.amount >= min);
  if (!isNaN(max)) result = result.filter((p) => p.price && p.price.amount <= max);

  return result;
}

export function ProductDashboard({ products }: { products: Product[] }) {
  const [search, setSearch] = useState('');
  const [dealsOnly, setDealsOnly] = useState(false);
  const [sort, setSort] = useState<SortOption>('deals');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const dealCount = useMemo(
    () => products.filter((p) => isGoodDeal(p.dealScore)).length,
    [products],
  );

  const filtered = useMemo(
    () => sortProducts(applyFilters(products, search, dealsOnly, minPrice, maxPrice), sort),
    [products, search, dealsOnly, sort, minPrice, maxPrice],
  );

  const hasActiveFilters = search || dealsOnly || minPrice || maxPrice;

  function resetFilters() {
    setSearch('');
    setDealsOnly(false);
    setMinPrice('');
    setMaxPrice('');
  }

  return (
    <div>
      {/* sticky top-14 offsets the fixed header (h-14 = 56px) */}
      <div className="sticky top-14 z-10 bg-white/95 backdrop-blur-sm border-b border-gray-100 -mx-4 px-4 py-3 mb-6 shadow-sm">
        <div className="flex gap-2 items-center flex-wrap sm:flex-nowrap">
          <div className="relative flex-1 min-w-0">
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrer les produits…"
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 bg-white focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 text-sm transition-shadow"
            />
          </div>

          {dealCount > 0 && (
            <button
              onClick={() => setDealsOnly((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-all whitespace-nowrap ${
                dealsOnly
                  ? 'bg-emerald-500 text-white shadow-sm'
                  : 'border border-gray-200 text-gray-600 hover:border-emerald-300 hover:text-emerald-700 hover:bg-emerald-50'
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
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
            className="px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 bg-white focus:outline-none focus:border-indigo-400 cursor-pointer whitespace-nowrap"
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
                ? 'border-indigo-300 bg-indigo-50 text-indigo-600'
                : 'border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-300'
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
            <span className="text-xs text-gray-500 font-medium">Prix :</span>
            <input
              type="number"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              placeholder="Min €"
              min="0"
              className="w-24 px-2.5 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100"
            />
            <span className="text-gray-300 text-sm">—</span>
            <input
              type="number"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              placeholder="Max €"
              min="0"
              className="w-24 px-2.5 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100"
            />
            {(minPrice || maxPrice) && (
              <button
                onClick={() => { setMinPrice(''); setMaxPrice(''); }}
                className="text-xs text-rose-500 hover:text-rose-700 transition-colors"
              >
                Effacer
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">
          <span className="font-semibold text-gray-900">{filtered.length}</span>
          {' '}produit{filtered.length !== 1 ? 's' : ''}
          {filtered.length !== products.length && (
            <span className="text-gray-400"> sur {products.length}</span>
          )}
        </p>
        {hasActiveFilters && (
          <button
            onClick={resetFilters}
            className="text-xs text-indigo-600 hover:text-indigo-800 hover:underline transition-colors"
          >
            Réinitialiser les filtres
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-24 text-gray-400">
          <p className="text-5xl mb-4">🔍</p>
          <p className="text-base">Aucun produit ne correspond aux filtres.</p>
          <button onClick={resetFilters} className="mt-4 text-sm text-indigo-600 hover:underline">
            Réinitialiser
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-10">
          {filtered.map((p) => (
            <ProductCard key={p.url} product={p} />
          ))}
        </div>
      )}
    </div>
  );
}

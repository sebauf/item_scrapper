'use client';
import { useState } from 'react';
import Image from 'next/image';
import type { Product, PriceHistoryEntry } from '@/types/product';
import { formatPrice } from '@/lib/format';
import { isGoodDeal } from '@/lib/constants';

function discountPct(price: number, crossed: number): number {
  return Math.round((1 - price / crossed) * 100);
}

function TrendBadge({ trend }: { trend: 'up' | 'down' | 'stable' }) {
  if (trend === 'down')
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
        ↓ Baisse
      </span>
    );
  if (trend === 'up')
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-orange-700 bg-orange-100 px-2 py-0.5 rounded-full">
        ↑ Hausse
      </span>
    );
  return null;
}

function PriceHistoryAccordion({ history }: { history: PriceHistoryEntry[] }) {
  const [open, setOpen] = useState(false);

  if (history.length === 0) return null;

  const recentFive = [...history].reverse().slice(0, 5);

  return (
    <div className="mt-2 pt-2 border-t border-gray-100">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="flex items-center justify-between w-full text-xs text-gray-400 hover:text-gray-600 transition-colors group/acc"
      >
        <span className="group-hover/acc:text-gray-600">
          Historique ({history.length} entr{history.length > 1 ? 'ées' : 'ée'})
        </span>
        <svg
          className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          className="mt-2 flex flex-col gap-1.5"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          {recentFive.map((entry, i) => {
            const prev = recentFive[i + 1];
            const priceDiff =
              entry.price && prev?.price ? entry.price.amount - prev.price.amount : null;

            return (
              <div key={entry.day} className="flex items-center justify-between">
                <span className="text-xs text-gray-400">
                  {new Date(entry.day).toLocaleDateString('fr-FR')}
                </span>
                <div className="flex items-center gap-2">
                  {entry.price && (
                    <span className={`text-xs font-semibold ${i === 0 ? 'text-gray-800' : 'text-gray-500'}`}>
                      {formatPrice(entry.price.amount, entry.price.currency)}
                    </span>
                  )}
                  {priceDiff !== null && (
                    <span className={`text-xs ${priceDiff < 0 ? 'text-emerald-500' : priceDiff > 0 ? 'text-rose-400' : 'text-gray-300'}`}>
                      {priceDiff < 0 ? '↓' : priceDiff > 0 ? '↑' : '–'}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ProductCard({ product }: { product: Product }) {
  const {
    price,
    crossedOutPrice,
    unitPrice,
    deliveryDate,
    dealScore,
    predictedPrice,
    trendDirection,
    priceHistory = [],
  } = product;

  const hasDeal = isGoodDeal(dealScore);

  return (
    <a
      href={product.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex flex-col rounded-2xl border transition-all duration-200 overflow-hidden group hover:shadow-xl ${
        hasDeal
          ? 'border-emerald-200 bg-emerald-50/20 hover:border-emerald-300'
          : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
    >
      <div className="relative h-48 bg-gray-50 shrink-0 overflow-hidden">
        {product.images[0] ? (
          <Image
            src={product.images[0]}
            alt={product.title}
            fill
            className="object-contain p-3 group-hover:scale-105 transition-transform duration-300"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        ) : (
          <div className="h-full flex items-center justify-center text-gray-200">
            <svg className="w-14 h-14" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
        {hasDeal && (
          <div className="absolute top-2 left-2 bg-emerald-500 text-white text-xs font-bold px-2.5 py-1 rounded-lg shadow-sm">
            🔥 −{Math.round(dealScore!)}%
          </div>
        )}
        {trendDirection && trendDirection !== 'stable' && (
          <div className="absolute top-2 right-2">
            <TrendBadge trend={trendDirection} />
          </div>
        )}
      </div>

      <div className="p-4 flex flex-col gap-2 flex-1">
        <p className="text-sm font-medium line-clamp-2 text-gray-800 leading-snug">{product.title}</p>

        <div className="mt-auto flex flex-col gap-1.5">
          <div className="flex items-baseline gap-2 flex-wrap">
            {price && (
              <span className="text-lg font-bold text-gray-900">
                {formatPrice(price.amount, price.currency)}
              </span>
            )}
            {crossedOutPrice && price && (
              <>
                <span className="text-sm text-gray-400 line-through">
                  {formatPrice(crossedOutPrice.amount, crossedOutPrice.currency)}
                </span>
                <span className="text-xs font-semibold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded">
                  −{discountPct(price.amount, crossedOutPrice.amount)}%
                </span>
              </>
            )}
          </div>

          {unitPrice && price && (
            <p className="text-xs text-gray-400">
              {formatPrice(unitPrice.amount, price.currency)}/{unitPrice.unit}
            </p>
          )}

          {deliveryDate && (
            <p className="text-xs text-gray-400">📦 {deliveryDate}</p>
          )}

          {predictedPrice !== undefined && price && (
            <p className="text-xs text-gray-500">
              Prix attendu :{' '}
              <span className="font-semibold">{formatPrice(predictedPrice, price.currency)}</span>
            </p>
          )}

          <PriceHistoryAccordion history={priceHistory} />
        </div>
      </div>
    </a>
  );
}

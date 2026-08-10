'use client';
import { useTransition } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import type { ProductDetail } from '@/lib/api';
import { formatPrice } from '@/lib/format';
import { removeFavoriteAction } from '@/app/actions';
import { PriceChart, type PricePoint } from './PriceChart';
import { TrendBadge } from './ProductCard';

/**
 * Retrait direct, sans confirmation : contrairement à `deleteKeyword`, perdre
 * un favori n'a pas de conséquence — le suivi de prix continue, et le
 * reproduire est un clic sur `FavoriteButton` depuis la fiche produit.
 */
export function FavoriteCard({ product }: { product: ProductDetail }) {
  const [isPending, startTransition] = useTransition();

  const chartData: PricePoint[] = product.history.map((entry) => ({
    day: entry.day,
    price: entry.price?.amount ?? null,
    crossedOut: entry.crossedOutPrice?.amount ?? null,
  }));
  const chartablePoints = chartData.filter((d) => d.price !== null).length;
  const currency =
    product.price?.currency ?? product.history.find((e) => e.price)?.price?.currency ?? 'EUR';

  function remove() {
    startTransition(() => {
      void removeFavoriteAction(product.id);
    });
  }

  return (
    <div
      className={`rounded-2xl border overflow-hidden ${
        product.isDeal ? 'border-deal-border bg-deal-soft/20' : 'border-border bg-surface'
      }`}
    >
      <div className="flex items-start gap-3 p-4">
        <Link
          href={`/product/${product.id}`}
          className="relative w-16 h-16 shrink-0 rounded-lg bg-image-bg overflow-hidden border border-border-subtle"
        >
          {product.images[0] && (
            <Image
              src={product.images[0]}
              alt={product.title}
              fill
              className="object-contain p-1.5"
              sizes="64px"
            />
          )}
        </Link>

        <div className="min-w-0 flex-1">
          <Link
            href={`/product/${product.id}`}
            className="font-medium text-sm text-foreground line-clamp-2 hover:text-accent transition-colors"
          >
            {product.title}
          </Link>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {product.price && (
              <span className="font-bold text-foreground">
                {formatPrice(product.price.amount, product.price.currency)}
              </span>
            )}
            {product.crossedOutPrice && product.price && (
              <span className="text-xs text-faint line-through">
                {formatPrice(product.crossedOutPrice.amount, product.crossedOutPrice.currency)}
              </span>
            )}
            {product.trendDirection && product.trendDirection !== 'stable' && (
              <TrendBadge trend={product.trendDirection} />
            )}
          </div>
        </div>

        <button
          onClick={remove}
          disabled={isPending}
          title="Retirer des favoris"
          className="shrink-0 p-1.5 text-warn hover:bg-warn-soft rounded-lg transition-colors disabled:opacity-50"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.914c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.783-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
            />
          </svg>
        </button>
      </div>

      <div className="px-4 pb-4">
        {chartablePoints >= 2 ? (
          <PriceChart
            data={chartData}
            predictedPrice={product.predictedPrice ?? undefined}
            currency={currency}
          />
        ) : (
          <p className="text-xs text-faint py-6 text-center">
            Historique insuffisant pour tracer une courbe.
          </p>
        )}
      </div>
    </div>
  );
}

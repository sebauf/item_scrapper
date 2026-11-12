'use client';
import { useTransition } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import type { ProductDetail } from '@/lib/api';
import { formatPrice } from '@/lib/format';
import { removeFavoriteAction } from '@/app/actions';
import { priceChartData } from '@/lib/price-history';
import { PriceChart } from './PriceChart';
import { TrendBadge } from './ProductCard';
import { StarIcon } from './StarIcon';

/**
 * Retrait direct, sans confirmation : contrairement à `deleteKeyword`, perdre
 * un favori n'a pas de conséquence — le suivi de prix continue, et le
 * reproduire est un clic sur `FavoriteButton` depuis la fiche produit.
 */
export function FavoriteCard({ product }: { product: ProductDetail }) {
  const [isPending, startTransition] = useTransition();

  const chart = priceChartData(product);

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
          <StarIcon filled className="w-5 h-5" />
        </button>
      </div>

      <div className="px-4 pb-4">
        {chart.chartable ? (
          <PriceChart
            data={chart.points}
            predictedPrice={product.predictedPrice ?? undefined}
            currency={chart.currency}
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

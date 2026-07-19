import Image from 'next/image';
import Link from 'next/link';
import type { Product } from '@/types/product';
import { formatPrice } from '@/lib/format';
import { isGoodDeal } from '@/lib/constants';
import { encodeProductId } from '@/lib/encoding';

function discountPct(price: number, crossed: number): number {
  return Math.round((1 - price / crossed) * 100);
}

export function TrendBadge({ trend }: { trend: 'up' | 'down' | 'stable' }) {
  if (trend === 'down')
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-deal bg-deal-soft px-2 py-0.5 rounded-full">
        ↓ Baisse
      </span>
    );
  if (trend === 'up')
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-warn bg-warn-soft px-2 py-0.5 rounded-full">
        ↑ Hausse
      </span>
    );
  return null;
}

export function ProductCard({ product }: { product: Product }) {
  const { price, crossedOutPrice, unitPrice, deliveryDate, dealScore, predictedPrice, trendDirection } =
    product;

  const hasDeal = isGoodDeal(dealScore);

  return (
    <Link
      href={`/product/${encodeProductId(product.url)}`}
      className={`flex flex-col rounded-2xl border transition-all duration-200 overflow-hidden group hover:shadow-xl ${
        hasDeal
          ? 'border-deal-border bg-deal-soft/20 hover:border-deal-strong/60'
          : 'border-border bg-surface hover:border-ghost'
      }`}
    >
      <div className="relative h-48 bg-image-bg shrink-0 overflow-hidden">
        {product.images[0] ? (
          <Image
            src={product.images[0]}
            alt={product.title}
            fill
            className="object-contain p-3 group-hover:scale-105 transition-transform duration-300"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        ) : (
          <div className="h-full flex items-center justify-center text-ghost">
            <svg className="w-14 h-14" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
        {hasDeal && (
          <div className="absolute top-2 left-2 bg-deal-strong text-white text-xs font-bold px-2.5 py-1 rounded-lg shadow-sm">
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
        <p className="text-sm font-medium line-clamp-2 text-foreground leading-snug">
          {product.title}
        </p>

        <div className="mt-auto flex flex-col gap-1.5">
          <div className="flex items-baseline gap-2 flex-wrap">
            {price && (
              <span className="text-lg font-bold text-foreground">
                {formatPrice(price.amount, price.currency)}
              </span>
            )}
            {crossedOutPrice && price && (
              <>
                <span className="text-sm text-faint line-through">
                  {formatPrice(crossedOutPrice.amount, crossedOutPrice.currency)}
                </span>
                <span className="text-xs font-semibold text-danger bg-danger-soft px-1.5 py-0.5 rounded">
                  −{discountPct(price.amount, crossedOutPrice.amount)}%
                </span>
              </>
            )}
          </div>

          {unitPrice && price && (
            <p className="text-xs text-faint">
              {formatPrice(unitPrice.amount, price.currency)}/{unitPrice.unit}
            </p>
          )}

          {deliveryDate && <p className="text-xs text-faint">📦 {deliveryDate}</p>}

          {predictedPrice !== undefined && price && (
            <p className="text-xs text-muted">
              Prix attendu :{' '}
              <span className="font-semibold">{formatPrice(predictedPrice, price.currency)}</span>
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}

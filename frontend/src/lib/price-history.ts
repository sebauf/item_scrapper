import type { ProductDetail } from '@/lib/api';

/** Un point du graphique d'évolution du prix. */
export interface PricePoint {
  day: string;
  price: number | null;
  crossedOut: number | null;
}

/** Il faut deux prix pour tracer une ligne ; en dessous, la courbe n'apprend rien. */
export const MIN_CHARTABLE_POINTS = 2;

export interface PriceChartData {
  points: PricePoint[];
  /** Assez de prix relevés pour tracer une courbe. */
  chartable: boolean;
  /** Devise du prix du jour, sinon du premier relevé avec prix, sinon l'euro. */
  currency: string;
}

export function priceChartData(product: Pick<ProductDetail, 'price' | 'history'>): PriceChartData {
  const points = product.history.map((entry) => ({
    day: entry.day,
    price: entry.price?.amount ?? null,
    crossedOut: entry.crossedOutPrice?.amount ?? null,
  }));
  return {
    points,
    chartable: points.filter((point) => point.price !== null).length >= MIN_CHARTABLE_POINTS,
    currency:
      product.price?.currency ?? product.history.find((e) => e.price)?.price?.currency ?? 'EUR',
  };
}

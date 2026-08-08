import { Document } from 'mongodb';
import { isDeal } from '../domain/deal-policy';
import { Money, TrendDirection, TREND_DIRECTIONS, UnitPrice } from '../domain/money';
import { ProductId } from '../domain/product-id';
import { PriceHistoryEntry, ProductSummary } from '../application/ports/product.read-model';

/**
 * Traduction document Mongo → DTO de lecture.
 *
 * C'est ici que s'arrête la connaissance du schéma de la base : au-delà, plus
 * personne ne sait que `deliveryDate` peut manquer ou que `day` est un objet
 * Date. Les `?? null` explicites évitent qu'un champ absent devienne
 * `undefined` et disparaisse silencieusement du JSON de réponse.
 */
export function toIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
  }
  return null;
}

function toMoney(value: unknown): Money | null {
  if (value === null || typeof value !== 'object') return null;
  const { amount, currency } = value as Partial<Money>;
  return typeof amount === 'number' && typeof currency === 'string' ? { amount, currency } : null;
}

function toUnitPrice(value: unknown): UnitPrice | null {
  if (value === null || typeof value !== 'object') return null;
  const { amount, unit } = value as Partial<UnitPrice>;
  return typeof amount === 'number' && typeof unit === 'string' ? { amount, unit } : null;
}

function toTrendDirection(value: unknown): TrendDirection | null {
  return TREND_DIRECTIONS.includes(value as TrendDirection) ? (value as TrendDirection) : null;
}

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function toProductSummary(doc: Document): ProductSummary {
  const url = String(doc.url);
  const dealScore = toNumber(doc.dealScore);

  return {
    id: ProductId.fromUrl(url).value,
    url,
    keyword: typeof doc.keyword === 'string' ? doc.keyword : null,
    shop: typeof doc.shop === 'string' ? doc.shop : 'amazon',
    title: typeof doc.title === 'string' ? doc.title : '',
    images: toStringArray(doc.images),
    price: toMoney(doc.price),
    crossedOutPrice: toMoney(doc.crossedOutPrice),
    unitPrice: toUnitPrice(doc.unitPrice),
    deliveryDate: typeof doc.deliveryDate === 'string' ? doc.deliveryDate : null,
    scrapedAt: toIso(doc.scrapedAt) ?? '',
    dealScore,
    predictedPrice: toNumber(doc.predictedPrice),
    trendDirection: toTrendDirection(doc.trendDirection),
    isDeal: isDeal(dealScore),
  };
}

export function toHistoryEntries(history: Document[] | undefined): PriceHistoryEntry[] {
  return (history ?? []).map((entry) => ({
    day: toIso(entry.day) ?? '',
    price: toMoney(entry.price),
    crossedOutPrice: toMoney(entry.crossedOutPrice),
    unitPrice: toUnitPrice(entry.unitPrice),
    scrapedAt: toIso(entry.scrapedAt) ?? '',
  }));
}

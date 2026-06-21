import type { Price, UnitPrice } from '../../../domain/product/Product.js';

export const CURRENCY_SYMBOL_TO_ISO: Record<string, string> = {
  '€': 'EUR',
  $: 'USD',
  '£': 'GBP',
};

export function parsePrice(text: string | null): Price | null {
  if (!text) return null;
  const match = text.match(/([€$£])?([\d\s]+[,.][\d]+)/);
  if (!match) return null;
  return {
    currency: CURRENCY_SYMBOL_TO_ISO[match[1] ?? '€'],
    amount: parseFloat(match[2].replace(/\s/g, '').replace(',', '.')),
  };
}

export function parseUnitPrice(raw: string | null): UnitPrice | null {
  if (!raw) return null;
  const priceMatch = raw.match(/([\d]+[,.][\d]+)\s*€/);
  const unitMatch = raw.match(/(?:\/|par)\s*([\w\s/]+?)[\s)$]/i);
  if (!priceMatch) return null;
  return {
    amount: parseFloat(priceMatch[1].replace(',', '.')),
    unit: unitMatch?.[1]?.trim() ?? '',
  };
}

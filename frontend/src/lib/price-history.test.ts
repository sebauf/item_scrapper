import { describe, expect, it } from 'vitest';
import type { PriceHistoryEntry } from '@/lib/api';
import { priceChartData } from './price-history';

function entry(day: string, amount: number | null, currency = 'EUR'): PriceHistoryEntry {
  return {
    day,
    price: amount === null ? null : { amount, currency },
    crossedOutPrice: null,
    unitPrice: null,
    scrapedAt: `${day}T06:00:00.000Z`,
  };
}

describe('priceChartData', () => {
  it('trace une courbe à partir de deux prix relevés', () => {
    const data = priceChartData({
      price: null,
      history: [entry('2026-11-01', 9.9), entry('2026-11-02', null), entry('2026-11-03', 8.5)],
    });

    expect(data.chartable).toBe(true);
    expect(data.points).toEqual([
      { day: '2026-11-01', price: 9.9, crossedOut: null },
      { day: '2026-11-02', price: null, crossedOut: null },
      { day: '2026-11-03', price: 8.5, crossedOut: null },
    ]);
  });

  it('ne trace rien avec un seul prix, même entouré de relevés sans prix', () => {
    const data = priceChartData({
      price: null,
      history: [entry('2026-11-01', null), entry('2026-11-02', 9.9)],
    });

    expect(data.chartable).toBe(false);
  });

  it('prend la devise du prix du jour, sinon du premier relevé avec prix, sinon l’euro', () => {
    expect(priceChartData({ price: { amount: 1, currency: 'USD' }, history: [] }).currency).toBe('USD');
    expect(
      priceChartData({ price: null, history: [entry('2026-11-01', null), entry('2026-11-02', 2, 'GBP')] })
        .currency,
    ).toBe('GBP');
    expect(priceChartData({ price: null, history: [] }).currency).toBe('EUR');
  });
});

import type { Dashboard, ProductDetail, ProductSummary } from '../backend/client.js';

/**
 * Jeux de données de test.
 *
 * Ils ont la forme exacte des DTO du backend — donc typés depuis le contrat
 * OpenAPI : si un champ disparaît côté API, ces fixtures ne compilent plus.
 */

export function aProduct(overrides: Partial<ProductSummary> = {}): ProductSummary {
  return {
    id: 'aHR0cHM6Ly9leGVtcGxl',
    url: 'https://www.amazon.fr/dp/B0TEST0001',
    keyword: 'lessive liquide',
    shop: 'amazon',
    title: 'Lessive liquide 3 L',
    images: ['https://img.example/1.jpg'],
    price: { amount: 12.99, currency: 'EUR' },
    crossedOutPrice: null,
    unitPrice: { amount: 4.33, unit: 'L' },
    deliveryDate: null,
    scrapedAt: '2026-08-08T06:00:00.000Z',
    dealScore: null,
    predictedPrice: null,
    trendDirection: null,
    isDeal: false,
    ...overrides,
  };
}

export function aScoredProduct(overrides: Partial<ProductSummary> = {}): ProductSummary {
  return aProduct({
    dealScore: 18.4,
    predictedPrice: 15.92,
    trendDirection: 'down',
    isDeal: true,
    ...overrides,
  });
}

export function aProductDetail(overrides: Partial<ProductDetail> = {}): ProductDetail {
  return {
    ...aScoredProduct(),
    firstSeen: '2026-06-01T06:00:00.000Z',
    lastSeen: '2026-08-08T06:00:00.000Z',
    history: [
      {
        day: '2026-08-06',
        price: { amount: 15.5, currency: 'EUR' },
        crossedOutPrice: null,
        unitPrice: null,
        scrapedAt: '2026-08-06T06:00:00.000Z',
      },
      {
        day: '2026-08-07',
        price: { amount: 15.9, currency: 'EUR' },
        crossedOutPrice: null,
        unitPrice: null,
        scrapedAt: '2026-08-07T06:00:00.000Z',
      },
      {
        day: '2026-08-08',
        price: { amount: 12.99, currency: 'EUR' },
        crossedOutPrice: null,
        unitPrice: null,
        scrapedAt: '2026-08-08T06:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

export function aDashboard(overrides: Partial<Dashboard> = {}): Dashboard {
  return {
    keywordCount: 1,
    productCount: 42,
    dealCount: 3,
    lastUpdate: '2026-08-08T06:12:00.000Z',
    dealsByKeyword: [
      {
        keyword: 'lessive liquide',
        productCount: 42,
        totalDeals: 3,
        deals: [aScoredProduct()],
      },
    ],
    ...overrides,
  };
}

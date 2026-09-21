import type { ProductSummary } from '@/lib/api';

/**
 * Produit de référence pour les tests de rendu.
 *
 * Tous les champs de scoring valent `null` par défaut, comme pour un produit
 * pas encore assez relevé : c'est le cas le plus fréquent en base, et celui qui
 * casse l'affichage si un composant oublie de les tester avec `!== null`.
 */
export function aProduct(overrides: Partial<ProductSummary> = {}): ProductSummary {
  return {
    id: 'aHR0cHM6Ly93d3cuYW1hem9uLmZyL2RwL0IwVEVTVDAwMDE',
    url: 'https://www.amazon.fr/dp/B0TEST0001',
    keyword: 'lessive',
    shop: 'amazon',
    title: 'Lessive liquide 3L',
    images: ['https://img.example/a.jpg'],
    price: { amount: 12.99, currency: 'EUR' },
    crossedOutPrice: null,
    unitPrice: null,
    deliveryDate: null,
    scrapedAt: '2026-08-08T06:00:00.000Z',
    dealScore: null,
    predictedPrice: null,
    trendDirection: null,
    isDeal: false,
    ...overrides,
  };
}

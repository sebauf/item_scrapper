import type { FuelPrice, FuelStation, ProductSummary } from '@/lib/api';

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

/** Prix de carburant disponible et frais par défaut. */
export function aFuelPrice(overrides: Partial<FuelPrice> = {}): FuelPrice {
  return {
    code: 'gazole',
    price: 1.689,
    updatedAt: '2026-10-26T07:42:00.000Z',
    available: true,
    shortageSince: null,
    isStale: false,
    ...overrides,
  };
}

export function aFuelStation(overrides: Partial<FuelStation> = {}): FuelStation {
  return {
    id: '69003001',
    address: '12 avenue Félix Faure',
    city: 'Lyon',
    postcode: '69003',
    roadType: 'R',
    latitude: 45.75938,
    longitude: 4.85491,
    distanceKm: 1.234,
    fuels: [aFuelPrice()],
    ...overrides,
  };
}

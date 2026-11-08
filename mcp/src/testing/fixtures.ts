import type {
  Dashboard,
  FavoriteStationDetailsList,
  FuelPrice,
  FuelStation,
  FuelStationSearchResult,
  ProductDetail,
  ProductSummary,
  TrackedUrlSummary,
} from '../backend/client.js';

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

export function aTrackedUrlSummary(overrides: Partial<TrackedUrlSummary> = {}): TrackedUrlSummary {
  return {
    id: 'aHR0cHM6Ly9leGVtcGxl',
    url: 'https://www.amazon.fr/dp/B0TEST0001/',
    title: 'Lessive liquide 3 L',
    image: 'https://img.example/1.jpg',
    price: { amount: 12.99, currency: 'EUR' },
    lastScrape: '2026-08-08T06:00:00.000Z',
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

export function aFuelPrice(overrides: Partial<FuelPrice> = {}): FuelPrice {
  return {
    code: 'gazole',
    price: 1.689,
    updatedAt: '2026-11-08T08:12:00.000Z',
    available: true,
    shortageSince: null,
    isStale: false,
    ...overrides,
  };
}

export function aFuelStation(overrides: Partial<FuelStation> = {}): FuelStation {
  return {
    id: '69003001',
    brand: 'TotalEnergies',
    name: 'TotalEnergies Lyon Félix Faure',
    address: '12 avenue Félix Faure',
    city: 'Lyon',
    postcode: '69003',
    roadType: 'R',
    latitude: 45.75938,
    longitude: 4.85491,
    distanceKm: 1.234,
    fuels: [
      aFuelPrice(),
      aFuelPrice({ code: 'e10', price: null, available: false, shortageSince: '2026-11-07T17:00:00.000Z' }),
    ],
    isFavorite: false,
    ...overrides,
  };
}

export function aFuelStationSearch(
  overrides: Partial<FuelStationSearchResult> = {},
): FuelStationSearchResult {
  return {
    stations: [aFuelStation()],
    truncated: false,
    brands: [{ brand: 'TotalEnergies', stationCount: 1 }],
    lastImportAt: '2026-11-08T13:30:00.000Z',
    staleAfterHours: 72,
    ...overrides,
  };
}

export function aFavoriteStationDetailsList(
  overrides: Partial<FavoriteStationDetailsList> = {},
): FavoriteStationDetailsList {
  return {
    stations: [
      {
        id: '69003001',
        addedAt: '2026-10-01T10:00:00.000Z',
        station: {
          brand: 'TotalEnergies',
          name: null,
          address: '12 avenue Félix Faure',
          city: 'Lyon',
          postcode: '69003',
          roadType: 'R',
          latitude: 45.75938,
          longitude: 4.85491,
          fuels: [
            {
              ...aFuelPrice(),
              shortageOutlook: {
                risk: 0.62,
                level: 'likely',
                computedAt: '2026-11-08T13:30:00.000Z',
                horizonEnd: '2026-11-09T13:30:00.000Z',
              },
              restockOutlook: null,
            },
            {
              ...aFuelPrice({ code: 'e10', price: null, available: false, shortageSince: '2026-11-07T17:00:00.000Z' }),
              shortageOutlook: null,
              restockOutlook: {
                probability: 0.71,
                level: 'likely',
                computedAt: '2026-11-08T13:30:00.000Z',
                horizonEnd: '2026-11-09T13:30:00.000Z',
              },
            },
          ],
        },
      },
      { id: '75001002', addedAt: '2026-09-01T10:00:00.000Z', station: null },
    ],
    staleAfterHours: 72,
    forecast: {
      horizonHours: 24,
      maxAgeHours: 2,
      elevatedThreshold: 0.15,
      likelyThreshold: 0.5,
      computedAt: '2026-11-08T13:30:00.000Z',
    },
    restockForecast: {
      horizonHours: 24,
      maxAgeHours: 2,
      possibleThreshold: 0.2,
      likelyThreshold: 0.5,
      computedAt: '2026-11-08T13:30:00.000Z',
    },
    ...overrides,
  };
}

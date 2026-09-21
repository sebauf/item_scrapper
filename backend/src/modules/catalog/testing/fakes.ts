import { DashboardReadModel, DashboardSnapshot } from '../application/ports/dashboard.read-model';
import {
  ProductDetail,
  ProductReadModel,
  ProductSearchResult,
  ProductSummary,
} from '../application/ports/product.read-model';
import { ProductId } from '../domain/product-id';
import { ProductQuery } from '../domain/product-query';

/**
 * Doubles des ports de lecture du contexte Catalog.
 *
 * Les read models réels sont des agrégations Mongo : les tester demanderait un
 * serveur. Ce qui se teste sans base, c'est tout le reste — décodage de
 * l'identifiant, validation des critères, traduction en HTTP — à condition
 * d'avoir un double qui enregistre ce qu'on lui a demandé.
 */
export function aProductSummary(overrides: Partial<ProductSummary> = {}): ProductSummary {
  const url = overrides.url ?? 'https://www.amazon.fr/dp/B0TEST0001';
  return {
    id: ProductId.fromUrl(url).value,
    url,
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

export function aProductDetail(overrides: Partial<ProductDetail> = {}): ProductDetail {
  return {
    ...aProductSummary(overrides),
    history: [],
    firstSeen: '2026-08-01T00:00:00.000Z',
    lastSeen: '2026-08-08T00:00:00.000Z',
    ...overrides,
  };
}

export const EMPTY_SEARCH_RESULT: ProductSearchResult = {
  items: [],
  total: 0,
  pageCount: 0,
  keywordTotal: 0,
  keywordDealCount: 0,
};

export class FakeProductReadModel extends ProductReadModel {
  /** Ce que le read model a reçu — c'est là que se vérifie la normalisation. */
  readonly searchCalls: { keyword: string; query: ProductQuery }[] = [];
  readonly detailCalls: ProductId[] = [];

  constructor(
    private readonly details: Record<string, ProductDetail> = {},
    private readonly result: ProductSearchResult = EMPTY_SEARCH_RESULT,
  ) {
    super();
  }

  search(keyword: string, query: ProductQuery): Promise<ProductSearchResult> {
    this.searchCalls.push({ keyword, query });
    return Promise.resolve(this.result);
  }

  findDetail(id: ProductId): Promise<ProductDetail | null> {
    this.detailCalls.push(id);
    return Promise.resolve(this.details[id.url] ?? null);
  }
}

export class FakeDashboardReadModel extends DashboardReadModel {
  calls = 0;

  constructor(private readonly snapshot: DashboardSnapshot) {
    super();
  }

  load(): Promise<DashboardSnapshot> {
    this.calls += 1;
    return Promise.resolve(this.snapshot);
  }
}

export const EMPTY_DASHBOARD: DashboardSnapshot = {
  keywordCount: 0,
  productCount: 0,
  dealCount: 0,
  lastUpdate: null,
  dealsByKeyword: [],
};

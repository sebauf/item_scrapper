import type { components } from './api-types.js';

/**
 * Client HTTP de l'API backend.
 *
 * Le serveur MCP n'ouvre aucune connexion MongoDB : comme le frontend, il passe
 * par l'API, qui reste le seul lecteur applicatif de la base. Les types
 * viennent de `api-types.ts`, généré depuis `/openapi.json` (`npm run gen:api`) —
 * un DTO qui change de forme casse la compilation, pas la production.
 */

type Schemas = components['schemas'];

export type KeywordSummary = Schemas['KeywordSummaryResponse'];
export type Money = Schemas['MoneyResponse'];
export type UnitPrice = Schemas['UnitPriceResponse'];
export type ProductSummary = Schemas['ProductSummaryResponse'];
export type ProductDetail = Schemas['ProductDetailResponse'];
export type PriceHistoryEntry = Schemas['PriceHistoryEntryResponse'];
export type ProductSearchResult = Schemas['ProductSearchResponse'];
export type KeywordDeals = Schemas['KeywordDealsResponse'];
export type Dashboard = Schemas['DashboardResponse'];
export type TrackedUrlSummary = Schemas['TrackedUrlSummaryResponse'];

/** Filtres de `/keywords/{keyword}/products`, déjà normalisés par l'outil MCP. */
export interface ProductSearchParams {
  q?: string;
  dealsOnly?: boolean;
  minPrice?: number;
  maxPrice?: number;
  sort?: 'deals' | 'price_asc' | 'price_desc' | 'discount';
  page?: number;
}

export class BackendError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'BackendError';
  }
}

interface ErrorBody {
  code?: string;
  message?: string | string[];
}

export interface BackendClientOptions {
  baseUrl: string;
  timeoutMs: number;
  /** Injectable pour les tests : par défaut le `fetch` global de Node. */
  fetchImpl?: typeof fetch;
}

export class BackendClient {
  private readonly api: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor({ baseUrl, timeoutMs, fetchImpl }: BackendClientOptions) {
    this.api = `${baseUrl.replace(/\/+$/, '')}/api/v1`;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl ?? fetch;
  }

  getDashboard(): Promise<Dashboard> {
    return this.request<Dashboard>('/dashboard');
  }

  listKeywords(): Promise<KeywordSummary[]> {
    return this.request<KeywordSummary[]>('/keywords');
  }

  async trackKeyword(keyword: string): Promise<void> {
    await this.request<void>('/keywords', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keyword }),
    });
  }

  async untrackKeyword(keyword: string): Promise<void> {
    await this.request<void>(`/keywords/${encodeURIComponent(keyword)}`, { method: 'DELETE' });
  }

  searchProducts(keyword: string, params: ProductSearchParams): Promise<ProductSearchResult> {
    return this.request<ProductSearchResult>(
      `/keywords/${encodeURIComponent(keyword)}/products${buildQueryString(params)}`,
    );
  }

  getProduct(id: string): Promise<ProductDetail> {
    return this.request<ProductDetail>(`/products/${encodeURIComponent(id)}`);
  }

  listTrackedUrls(): Promise<TrackedUrlSummary[]> {
    return this.request<TrackedUrlSummary[]>('/product-urls');
  }

  async trackProductUrl(url: string): Promise<void> {
    await this.request<void>('/product-urls', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
  }

  async untrackProductUrl(id: string): Promise<void> {
    await this.request<void>(`/product-urls/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  listFavorites(): Promise<ProductDetail[]> {
    return this.request<ProductDetail[]>('/favorites');
  }

  async addFavorite(id: string): Promise<void> {
    await this.request<void>('/favorites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    });
  }

  async removeFavorite(id: string): Promise<void> {
    await this.request<void>(`/favorites/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  /** Sonde de disponibilité utilisée par `/health/ready`. */
  async isBackendReady(): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout(`${this.api.replace(/\/api\/v1$/, '')}/health/ready`);
      return response.ok;
    } catch {
      return false;
    }
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchWithTimeout(this.api + path, init);
    if (!response.ok) throw await toBackendError(response, path);

    // POST /keywords répond 201 sans corps et DELETE répond 204 : se fier au
    // seul statut 204 ferait échouer le parsing JSON sur un 201 pourtant réussi.
    const body = await response.text();
    return (body ? (JSON.parse(body) as T) : (undefined as T));
  }

  /**
   * Un backend qui ne répond pas doit produire une erreur d'outil lisible, pas
   * un appel MCP qui pend jusqu'au timeout de l'agent.
   */
  private async fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new BackendError(504, 'BACKEND_TIMEOUT', `Le backend n'a pas répondu en ${this.timeoutMs} ms.`);
      }
      throw new BackendError(
        502,
        'BACKEND_UNREACHABLE',
        `Backend injoignable : ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

async function toBackendError(response: Response, path: string): Promise<BackendError> {
  let body: ErrorBody = {};
  try {
    body = (await response.json()) as ErrorBody;
  } catch {
    // Réponse non JSON (502 d'un proxy par exemple) : on garde le statut.
  }
  const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
  return new BackendError(
    response.status,
    body.code ?? null,
    message ?? `${path} → HTTP ${response.status}`,
  );
}

/**
 * Le backend refuse tout paramètre inconnu (`forbidNonWhitelisted`) : on
 * n'envoie que ce qui est renseigné, et sous la forme qu'il attend (`deals=1`).
 */
export function buildQueryString(params: ProductSearchParams): string {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.dealsOnly) query.set('deals', '1');
  if (params.minPrice !== undefined) query.set('min', String(params.minPrice));
  if (params.maxPrice !== undefined) query.set('max', String(params.maxPrice));
  if (params.sort) query.set('sort', params.sort);
  if (params.page !== undefined && params.page > 1) query.set('page', String(params.page));
  const serialised = query.toString();
  return serialised ? `?${serialised}` : '';
}

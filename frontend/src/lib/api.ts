import type { components } from './api-types';

/**
 * Client de l'API backend.
 *
 * C'est désormais le seul chemin d'accès aux données : le frontend n'ouvre plus
 * de connexion MongoDB. Tous les appels partent du serveur Next (Server
 * Components et Server Actions), jamais du navigateur — le backend est un
 * Service ClusterIP sans Ingress, injoignable depuis l'extérieur du cluster.
 * D'où l'absence de CORS et d'authentification à ce stade.
 *
 * Les types viennent de `api-types.ts`, généré depuis le contrat OpenAPI du
 * backend (`npm run gen:api`). Une réponse qui changerait de forme casserait
 * donc la compilation plutôt que l'affichage.
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
export type TrendDirection = NonNullable<ProductSummary['trendDirection']>;
export type TrackedUrlSummary = Schemas['TrackedUrlSummaryResponse'];

const BASE_URL = process.env.BACKEND_URL ?? 'http://localhost:3001';
const API = `${BASE_URL}/api/v1`;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ApiErrorBody {
  code?: string;
  message?: string | string[];
}

async function toApiError(response: Response, path: string): Promise<ApiError> {
  let body: ApiErrorBody = {};
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    // Réponse non JSON (502 d'un proxy, backend indisponible) : on garde le statut.
  }
  const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
  return new ApiError(
    response.status,
    body.code ?? null,
    message ?? `${path} → HTTP ${response.status}`,
  );
}

/**
 * `no-store` conserve exactement la fraîcheur d'avant la bascule : chaque rendu
 * interrogeait MongoDB, chaque rendu interroge maintenant l'API. Mettre en
 * cache serait un gain réel — les données ne bougent qu'une fois par jour,
 * après le DAG Airflow — mais c'est un changement de comportement à traiter
 * séparément, pas au milieu d'une migration.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(API + path, { cache: 'no-store', ...init });
  if (!response.ok) throw await toApiError(response, path);

  // Toutes les réponses de succès ne portent pas un corps : POST /keywords
  // répond 201 sans contenu, DELETE répond 204. Se fier au seul statut 204
  // ferait échouer le parsing JSON sur un 201 pourtant réussi.
  const body = await response.text();
  return (body ? JSON.parse(body) : undefined) as T;
}

export function getDashboard(): Promise<Dashboard> {
  return request<Dashboard>('/dashboard');
}

export function getKeywords(): Promise<KeywordSummary[]> {
  return request<KeywordSummary[]>('/keywords');
}

export function trackKeyword(keyword: string): Promise<void> {
  return request<void>('/keywords', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ keyword }),
  });
}

export function untrackKeyword(keyword: string): Promise<void> {
  return request<void>(`/keywords/${encodeURIComponent(keyword)}`, { method: 'DELETE' });
}

/**
 * `queryString` est produit par `buildQueryString` — donc déjà normalisé. Le
 * backend est strict et refuse une valeur aberrante ; c'est le frontend qui
 * reste indulgent, parce que lui lit une URL tapée par un humain.
 */
export function searchProducts(
  keyword: string,
  queryString: string,
): Promise<ProductSearchResult> {
  return request<ProductSearchResult>(
    `/keywords/${encodeURIComponent(keyword)}/products${queryString}`,
  );
}

/** `null` si le produit est inconnu — les autres erreurs remontent. */
export async function getProduct(id: string): Promise<ProductDetail | null> {
  try {
    return await request<ProductDetail>(`/products/${id}`);
  } catch (error) {
    // Un id mal formé (400) est traité comme une absence : côté UI, une URL
    // bricolée à la main et un produit supprimé donnent la même page 404.
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) return null;
    throw error;
  }
}

export function getTrackedUrls(): Promise<TrackedUrlSummary[]> {
  return request<TrackedUrlSummary[]>('/product-urls');
}

export function trackProductUrl(url: string): Promise<void> {
  return request<void>('/product-urls', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });
}

export function untrackProductUrl(id: string): Promise<void> {
  return request<void>(`/product-urls/${id}`, { method: 'DELETE' });
}

export function getFavorites(): Promise<ProductDetail[]> {
  return request<ProductDetail[]>('/favorites');
}

export function isFavorite(id: string): Promise<boolean> {
  return request<{ isFavorite: boolean }>(`/favorites/${id}`).then((r) => r.isFavorite);
}

export function addFavorite(id: string): Promise<void> {
  return request<void>('/favorites', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  });
}

export function removeFavorite(id: string): Promise<void> {
  return request<void>(`/favorites/${id}`, { method: 'DELETE' });
}

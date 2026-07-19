export const SORT_OPTIONS = ['deals', 'price_asc', 'price_desc', 'discount'] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

export interface ProductListParams {
  q: string;
  deals: boolean;
  min?: number;
  max?: number;
  sort: SortOption;
  page: number;
}

export const DEFAULT_SORT: SortOption = 'deals';

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Parses raw searchParams defensively: garbage values fall back to defaults. */
export function parseProductListParams(
  sp: Record<string, string | string[] | undefined>,
): ProductListParams {
  const q = (first(sp.q) ?? '').trim().slice(0, 100);
  const deals = first(sp.deals) === '1';

  const minRaw = parseFloat(first(sp.min) ?? '');
  const maxRaw = parseFloat(first(sp.max) ?? '');
  const min = Number.isFinite(minRaw) && minRaw >= 0 ? minRaw : undefined;
  let max = Number.isFinite(maxRaw) && maxRaw >= 0 ? maxRaw : undefined;
  if (min !== undefined && max !== undefined && max < min) max = undefined;

  const sortRaw = first(sp.sort) ?? '';
  const sort = (SORT_OPTIONS as readonly string[]).includes(sortRaw)
    ? (sortRaw as SortOption)
    : DEFAULT_SORT;

  const pageRaw = parseInt(first(sp.page) ?? '', 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;

  return { q, deals, min, max, sort, page };
}

/** Builds a query string, omitting defaults so canonical URLs stay clean. */
export function buildQueryString(params: Partial<ProductListParams>): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set('q', params.q);
  if (params.deals) sp.set('deals', '1');
  if (params.min !== undefined) sp.set('min', String(params.min));
  if (params.max !== undefined) sp.set('max', String(params.max));
  if (params.sort && params.sort !== DEFAULT_SORT) sp.set('sort', params.sort);
  if (params.page && params.page > 1) sp.set('page', String(params.page));
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

export function hasActiveFilters(params: ProductListParams): boolean {
  return params.q !== '' || params.deals || params.min !== undefined || params.max !== undefined;
}

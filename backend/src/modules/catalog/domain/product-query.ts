import { InvalidProductQuery } from './catalog.errors';

export const PRODUCT_SORT_OPTIONS = ['deals', 'price_asc', 'price_desc', 'discount'] as const;
export type ProductSort = (typeof PRODUCT_SORT_OPTIONS)[number];

export const DEFAULT_SORT: ProductSort = 'deals';

/** Divisible par 1/2/3/4 — la grille du frontend ne finit jamais sur une ligne bancale. */
export const PAGE_SIZE = 24;

const MAX_SEARCH_LENGTH = 100;

export interface RawProductQuery {
  q?: string;
  deals?: string;
  min?: string;
  max?: string;
  sort?: string;
  page?: string;
}

/**
 * Objet-valeur décrivant une recherche de produits dans un mot-clé.
 *
 * Différence assumée avec frontend/src/lib/search-params.ts : celui-ci retombe
 * silencieusement sur les valeurs par défaut quand un paramètre est aberrant,
 * parce qu'il lit une URL tapée par un humain. Ici on refuse (400).
 *
 * Les deux comportements sont justes à leur place : indulgent au bord (la barre
 * d'adresse), strict à l'API. Le frontend continuera de normaliser l'URL avant
 * d'appeler le backend, qui ne verra donc jamais d'entrée aberrante — mais un
 * appel direct mal formé ne passera pas inaperçu.
 *
 * Un paramètre *absent* reste évidemment valide et prend sa valeur par défaut.
 */
export class ProductQuery {
  private constructor(
    readonly search: string | null,
    readonly dealsOnly: boolean,
    readonly minPrice: number | null,
    readonly maxPrice: number | null,
    readonly sort: ProductSort,
    readonly page: number,
  ) {}

  static create(raw: RawProductQuery): ProductQuery {
    const search = ProductQuery.parseSearch(raw.q);
    const dealsOnly = ProductQuery.parseDealsOnly(raw.deals);
    const minPrice = ProductQuery.parsePrice(raw.min, 'min');
    const maxPrice = ProductQuery.parsePrice(raw.max, 'max');
    const sort = ProductQuery.parseSort(raw.sort);
    const page = ProductQuery.parsePage(raw.page);

    if (minPrice !== null && maxPrice !== null && maxPrice < minPrice) {
      throw new InvalidProductQuery('« max » ne peut pas être inférieur à « min ».');
    }

    return new ProductQuery(search, dealsOnly, minPrice, maxPrice, sort, page);
  }

  /** Valeurs par défaut — utile aux tests et aux appels sans filtre. */
  static default(): ProductQuery {
    return ProductQuery.create({});
  }

  get skip(): number {
    return (this.page - 1) * PAGE_SIZE;
  }

  get limit(): number {
    return PAGE_SIZE;
  }

  get hasFilters(): boolean {
    return (
      this.search !== null || this.dealsOnly || this.minPrice !== null || this.maxPrice !== null
    );
  }

  private static parseSearch(raw: string | undefined): string | null {
    if (raw === undefined) return null;
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    if (trimmed.length > MAX_SEARCH_LENGTH) {
      throw new InvalidProductQuery(`« q » dépasse ${MAX_SEARCH_LENGTH} caractères.`);
    }
    return trimmed;
  }

  private static parseDealsOnly(raw: string | undefined): boolean {
    if (raw === undefined) return false;
    if (raw === '1' || raw === 'true') return true;
    if (raw === '0' || raw === 'false') return false;
    throw new InvalidProductQuery('« deals » attend 1/0 ou true/false.');
  }

  private static parsePrice(raw: string | undefined, field: 'min' | 'max'): number | null {
    if (raw === undefined || raw === '') return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      throw new InvalidProductQuery(`« ${field} » attend un nombre positif.`);
    }
    return value;
  }

  private static parseSort(raw: string | undefined): ProductSort {
    if (raw === undefined) return DEFAULT_SORT;
    if (!(PRODUCT_SORT_OPTIONS as readonly string[]).includes(raw)) {
      throw new InvalidProductQuery(`« sort » attend l'une de : ${PRODUCT_SORT_OPTIONS.join(', ')}.`);
    }
    return raw as ProductSort;
  }

  private static parsePage(raw: string | undefined): number {
    if (raw === undefined) return 1;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) {
      throw new InvalidProductQuery('« page » attend un entier supérieur ou égal à 1.');
    }
    return value;
  }
}

import { describe, expect, it } from 'vitest';
import {
  buildQueryString,
  DEFAULT_SORT,
  hasActiveFilters,
  parseProductListParams,
  type ProductListParams,
} from './search-params';

/**
 * Ce module est le point où une URL tapée (ou bricolée) par un humain devient
 * une requête API. Sa règle : être indulgent en lecture — une valeur aberrante
 * retombe sur la valeur par défaut au lieu de provoquer une erreur — et strict
 * en écriture, en n'émettant que ce qui s'écarte des valeurs par défaut.
 */
describe('parseProductListParams', () => {
  it('applique les valeurs par défaut sur une URL nue', () => {
    expect(parseProductListParams({})).toEqual({
      q: '',
      deals: false,
      min: undefined,
      max: undefined,
      sort: DEFAULT_SORT,
      page: 1,
    });
  });

  it('lit une URL complète', () => {
    expect(
      parseProductListParams({ q: 'savon', deals: '1', min: '5', max: '50', sort: 'price_asc', page: '3' }),
    ).toEqual({ q: 'savon', deals: true, min: 5, max: 50, sort: 'price_asc', page: 3 });
  });

  describe('recherche', () => {
    it('trime et plafonne à 100 caractères', () => {
      expect(parseProductListParams({ q: '  savon  ' }).q).toBe('savon');
      expect(parseProductListParams({ q: 'a'.repeat(150) }).q).toHaveLength(100);
    });

    it('ne garde que la première valeur d’un paramètre répété', () => {
      // `?q=a&q=b` arrive sous forme de tableau : en prendre un seul évite un
      // « a,b » qui ne correspondrait à rien.
      expect(parseProductListParams({ q: ['savon', 'lessive'] }).q).toBe('savon');
    });
  });

  describe('bonnes affaires', () => {
    it.each([
      ['1', true],
      ['0', false],
      ['true', false],
      ['', false],
    ])('deals=%s → %s', (raw, expected) => {
      // Seul « 1 » active le filtre : c'est ce que produit `buildQueryString`.
      expect(parseProductListParams({ deals: raw }).deals).toBe(expected);
    });
  });

  describe('bornes de prix', () => {
    it('accepte des décimaux et zéro', () => {
      expect(parseProductListParams({ min: '0', max: '12.5' })).toMatchObject({ min: 0, max: 12.5 });
    });

    it.each([['-1'], ['cher'], [''], ['NaN']])('ignore une borne invalide (%s)', (raw) => {
      expect(parseProductListParams({ min: raw }).min).toBeUndefined();
      expect(parseProductListParams({ max: raw }).max).toBeUndefined();
    });

    it('abandonne le maximum si l’intervalle est inversé', () => {
      // Garder min plutôt que rien : l'utilisateur voit un résultat plausible
      // au lieu d'une liste vide inexplicable.
      expect(parseProductListParams({ min: '50', max: '10' })).toMatchObject({
        min: 50,
        max: undefined,
      });
    });

    it('accepte un intervalle réduit à un point', () => {
      expect(parseProductListParams({ min: '10', max: '10' })).toMatchObject({ min: 10, max: 10 });
    });
  });

  describe('tri et pagination', () => {
    it.each([['deals'], ['price_asc'], ['price_desc'], ['discount']])('accepte sort=%s', (sort) => {
      expect(parseProductListParams({ sort }).sort).toBe(sort);
    });

    it('retombe sur le tri par défaut pour une valeur inconnue', () => {
      expect(parseProductListParams({ sort: 'le-moins-cher' }).sort).toBe(DEFAULT_SORT);
    });

    it.each([['0'], ['-2'], ['deux'], ['']])('retombe sur la page 1 (page=%s)', (page) => {
      expect(parseProductListParams({ page }).page).toBe(1);
    });

    it('tronque une page décimale', () => {
      expect(parseProductListParams({ page: '2.9' }).page).toBe(2);
    });
  });
});

describe('buildQueryString', () => {
  it('n’émet rien quand tout est par défaut', () => {
    expect(buildQueryString({})).toBe('');
    expect(buildQueryString({ q: '', deals: false, sort: DEFAULT_SORT, page: 1 })).toBe('');
  });

  it('émet les critères actifs', () => {
    expect(buildQueryString({ q: 'savon', deals: true, min: 5, max: 50, sort: 'price_asc', page: 3 })).toBe(
      '?q=savon&deals=1&min=5&max=50&sort=price_asc&page=3',
    );
  });

  it('émet une borne à zéro, qui est un filtre réel', () => {
    expect(buildQueryString({ min: 0 })).toBe('?min=0');
  });

  it('encode une recherche contenant des caractères spéciaux', () => {
    expect(buildQueryString({ q: 'lessive & savon' })).toBe('?q=lessive+%26+savon');
  });

  it('fait un aller-retour fidèle avec le parseur', () => {
    const params: ProductListParams = {
      q: 'savon',
      deals: true,
      min: 5,
      max: 50,
      sort: 'discount',
      page: 4,
    };
    const parsed = Object.fromEntries(new URLSearchParams(buildQueryString(params).slice(1)));

    expect(parseProductListParams(parsed)).toEqual(params);
  });
});

describe('hasActiveFilters', () => {
  const base = parseProductListParams({});

  it('ignore le tri et la pagination', () => {
    // Trier ou changer de page n'est pas « filtrer » : le bouton de
    // réinitialisation ne doit pas apparaître pour ça.
    expect(hasActiveFilters({ ...base, sort: 'price_asc', page: 3 })).toBe(false);
  });

  it.each([
    ['une recherche', { q: 'savon' }],
    ['le filtre affaires', { deals: true }],
    ['un prix minimum', { min: 5 }],
    ['un prix maximum', { max: 50 }],
    ['un prix minimum nul', { min: 0 }],
  ])('détecte %s', (_label, overrides) => {
    expect(hasActiveFilters({ ...base, ...overrides })).toBe(true);
  });
});

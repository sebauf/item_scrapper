import { InvalidProductQuery } from './catalog.errors';
import { PAGE_SIZE, ProductQuery } from './product-query';

describe('ProductQuery', () => {
  describe('valeurs par défaut', () => {
    it('accepte une requête vide', () => {
      const query = ProductQuery.default();
      expect(query).toMatchObject({
        search: null,
        dealsOnly: false,
        minPrice: null,
        maxPrice: null,
        sort: 'deals',
        page: 1,
      });
      expect(query.hasFilters).toBe(false);
    });

    it('calcule la pagination', () => {
      expect(ProductQuery.create({ page: '3' }).skip).toBe(2 * PAGE_SIZE);
      expect(ProductQuery.create({ page: '1' }).skip).toBe(0);
    });
  });

  describe('normalisation', () => {
    it('trime la recherche et traite le vide comme absent', () => {
      expect(ProductQuery.create({ q: '  savon  ' }).search).toBe('savon');
      expect(ProductQuery.create({ q: '   ' }).search).toBeNull();
    });

    it.each([
      ['1', true],
      ['true', true],
      ['0', false],
      ['false', false],
    ])('interprète deals=%s', (raw, expected) => {
      expect(ProductQuery.create({ deals: raw }).dealsOnly).toBe(expected);
    });

    it('signale la présence de filtres', () => {
      expect(ProductQuery.create({ min: '10' }).hasFilters).toBe(true);
      expect(ProductQuery.create({ sort: 'price_asc' }).hasFilters).toBe(false);
    });
  });

  describe('refus', () => {
    it.each([
      ['un tri inconnu', { sort: 'cheapest' }],
      ['une page à zéro', { page: '0' }],
      ['une page non entière', { page: '1.5' }],
      ['une page non numérique', { page: 'deux' }],
      ['un prix négatif', { min: '-1' }],
      ['un prix non numérique', { max: 'cher' }],
      ['un booléen fantaisiste', { deals: 'oui' }],
      ['une recherche trop longue', { q: 'a'.repeat(101) }],
      ['un intervalle inversé', { min: '50', max: '10' }],
    ])('refuse %s', (_label, raw) => {
      expect(() => ProductQuery.create(raw)).toThrow(InvalidProductQuery);
    });

    it('accepte un intervalle où min égale max', () => {
      expect(() => ProductQuery.create({ min: '10', max: '10' })).not.toThrow();
    });
  });
});

import { InvalidProductQuery } from '../../domain/catalog.errors';
import { PAGE_SIZE } from '../../domain/product-query';
import { aProductSummary, FakeProductReadModel } from '../../testing/fakes';
import { SearchProductsQuery } from './search-products.query';

/**
 * Le use case construit l'objet-valeur `ProductQuery` : le read model ne reçoit
 * donc jamais de critères bruts. C'est ce contrat qu'on vérifie ici — pas
 * l'agrégation Mongo, qui appartient à l'infrastructure.
 */
describe('SearchProductsQuery', () => {
  function query() {
    const readModel = new FakeProductReadModel({}, {
      items: [aProductSummary()],
      total: 1,
      pageCount: 1,
      keywordTotal: 12,
      keywordDealCount: 3,
    });
    return { readModel, useCase: new SearchProductsQuery(readModel) };
  }

  it('transmet le mot-clé tel quel et renvoie le résultat du read model', async () => {
    const { readModel, useCase } = query();

    const result = await useCase.execute('lessive liquide', {});

    expect(result.keywordTotal).toBe(12);
    expect(readModel.searchCalls[0].keyword).toBe('lessive liquide');
  });

  it('normalise les critères avant de les transmettre', async () => {
    const { readModel, useCase } = query();

    await useCase.execute('lessive', { q: '  savon  ', deals: '1', min: '5', page: '2' });

    expect(readModel.searchCalls[0].query).toMatchObject({
      search: 'savon',
      dealsOnly: true,
      minPrice: 5,
      maxPrice: null,
      page: 2,
      skip: PAGE_SIZE,
    });
  });

  it('applique les valeurs par défaut sur une requête vide', async () => {
    const { readModel, useCase } = query();

    await useCase.execute('lessive', {});

    expect(readModel.searchCalls[0].query).toMatchObject({
      search: null,
      dealsOnly: false,
      sort: 'deals',
      page: 1,
    });
  });

  it('refuse un critère aberrant avant tout appel au read model', () => {
    const { readModel, useCase } = query();

    // Le refus est synchrone : `execute` n'est pas `async`, et `ProductQuery.create`
    // lève avant qu'une promesse n'existe. Sans conséquence côté HTTP (Nest
    // enveloppe l'appel du handler), mais il faut le tester comme tel.
    expect(() => useCase.execute('lessive', { sort: 'le-moins-cher' })).toThrow(
      InvalidProductQuery,
    );
    expect(readModel.searchCalls).toHaveLength(0);
  });

  it("un mot-clé inconnu n'est pas une erreur, juste un résultat vide", async () => {
    const readModel = new FakeProductReadModel();

    const result = await new SearchProductsQuery(readModel).execute('inexistant', {});

    expect(result).toMatchObject({ items: [], total: 0, keywordTotal: 0 });
  });
});

import { Db, Document } from 'mongodb';
import {
  KeywordSummary,
  KeywordSummaryReadModel,
} from 'src/modules/keyword/application/ports/keyword-summary.read-model';
import { MongoDashboardReadModel } from './mongo-dashboard.read-model';

class FakeKeywordSummaryReadModel extends KeywordSummaryReadModel {
  constructor(private readonly names: string[]) {
    super();
  }

  listTracked(): Promise<KeywordSummary[]> {
    return Promise.resolve([]);
  }

  listTrackedNames(): Promise<string[]> {
    return Promise.resolve(this.names);
  }
}

/**
 * Le tableau de bord nomme des mots-clés, et il les tirait d'`items_raw` : un
 * mot-clé retiré y gardait donc son bloc, jusqu'à ce que le scrape suivant
 * cesse de le rafraîchir. Ces tests figent la source de cette liste.
 */
describe('MongoDashboardReadModel', () => {
  function stubDb(productCounts: { keyword: string; productCount: number }[]): Db {
    return {
      collection: (name: string) => {
        if (name === 'price_history') {
          return { findOne: () => Promise.resolve(null) };
        }
        return {
          // findLastScrapeDay
          findOne: () => Promise.resolve({ day: new Date('2026-08-08T00:00:00.000Z') }),
          countDocuments: () => Promise.resolve(42),
          // Deux agrégations sur items_raw : les produits par mot-clé, et les
          // bonnes affaires du jour. Le `$lookup` sur `deal_scores` n'appartient
          // qu'à la seconde — s'en servir pour les distinguer vaut mieux que de
          // compter sur l'ordre des appels.
          aggregate: (pipeline: Document[]) => ({
            toArray: () =>
              Promise.resolve(pipeline.some((stage) => '$lookup' in stage) ? [] : productCounts),
          }),
        };
      },
    } as unknown as Db;
  }

  it('ne fait un bloc que pour les mots-clés suivis', async () => {
    const readModel = new MongoDashboardReadModel(
      stubDb([
        { keyword: 'lessive', productCount: 4 },
        { keyword: 'retire', productCount: 9 },
      ]),
      new FakeKeywordSummaryReadModel(['lessive']),
    );

    const snapshot = await readModel.load();

    expect(snapshot.dealsByKeyword.map((block) => block.keyword)).toEqual(['lessive']);
  });

  it('annonce autant de mots-clés que le contexte Keyword en suit', async () => {
    const readModel = new MongoDashboardReadModel(
      stubDb([{ keyword: 'lessive', productCount: 4 }]),
      new FakeKeywordSummaryReadModel(['lessive', 'café']),
    );

    const snapshot = await readModel.load();

    // « café » n'a encore aucun produit : il compte, sans bloc à afficher.
    expect(snapshot.keywordCount).toBe(2);
    expect(snapshot.dealsByKeyword.map((block) => block.keyword)).toEqual(['lessive']);
  });
});

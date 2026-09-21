import { KeywordSummary, KeywordSummaryReadModel } from '../ports/keyword-summary.read-model';
import { ListKeywordSummariesQuery } from './list-keyword-summaries.query';

class FakeKeywordSummaryReadModel extends KeywordSummaryReadModel {
  calls = 0;

  constructor(private readonly summaries: KeywordSummary[]) {
    super();
  }

  listTracked(): Promise<KeywordSummary[]> {
    this.calls += 1;
    return Promise.resolve(this.summaries);
  }
}

/**
 * Simple délégation aujourd'hui — le test vaut quand même : il fige le fait que
 * le controller passe par la couche application, et que le read model est bien
 * celui des mots-clés *suivis* (un mot-clé retiré ne doit pas réapparaître).
 */
describe('ListKeywordSummariesQuery', () => {
  it('renvoie les résumés des mots-clés suivis', async () => {
    const summaries = [
      { keyword: 'lessive', productCount: 42, lastScrape: '2026-08-08T06:00:00.000Z' },
      { keyword: 'café', productCount: 0, lastScrape: null },
    ];
    const readModel = new FakeKeywordSummaryReadModel(summaries);

    await expect(new ListKeywordSummariesQuery(readModel).execute()).resolves.toBe(summaries);
    expect(readModel.calls).toBe(1);
  });

  it("supporte l'absence de mot-clé suivi", async () => {
    await expect(
      new ListKeywordSummariesQuery(new FakeKeywordSummaryReadModel([])).execute(),
    ).resolves.toEqual([]);
  });
});

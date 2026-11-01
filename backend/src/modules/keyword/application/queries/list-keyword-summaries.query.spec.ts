import { UserId } from 'src/shared/domain/user-id';
import { KeywordSummary, KeywordSummaryReadModel } from '../ports/keyword-summary.read-model';
import { ListKeywordSummariesQuery } from './list-keyword-summaries.query';

class FakeKeywordSummaryReadModel extends KeywordSummaryReadModel {
  readonly owners: UserId[] = [];

  constructor(private readonly summaries: KeywordSummary[]) {
    super();
  }

  listTracked(owner: UserId): Promise<KeywordSummary[]> {
    this.owners.push(owner);
    return Promise.resolve(this.summaries);
  }

  listTrackedNames(): Promise<string[]> {
    return Promise.resolve(this.summaries.map((summary) => summary.keyword));
  }
}

const alice = UserId.create('alice@example.com');

/**
 * Simple délégation aujourd'hui — le test vaut quand même : il fige le fait que
 * le controller passe par la couche application, et que l'utilisateur est bien
 * transmis au read model (sinon chacun verrait les mots-clés de tous).
 */
describe('ListKeywordSummariesQuery', () => {
  it('renvoie les résumés des mots-clés suivis par l’utilisateur', async () => {
    const summaries = [
      { keyword: 'lessive', productCount: 42, lastScrape: '2026-08-08T06:00:00.000Z' },
      { keyword: 'café', productCount: 0, lastScrape: null },
    ];
    const readModel = new FakeKeywordSummaryReadModel(summaries);

    await expect(new ListKeywordSummariesQuery(readModel).execute(alice)).resolves.toBe(summaries);
    expect(readModel.owners).toEqual([alice]);
  });

  it("supporte l'absence de mot-clé suivi", async () => {
    await expect(
      new ListKeywordSummariesQuery(new FakeKeywordSummaryReadModel([])).execute(alice),
    ).resolves.toEqual([]);
  });
});

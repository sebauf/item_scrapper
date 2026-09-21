import {
  TrackedUrlSummary,
  TrackedUrlSummaryReadModel,
} from '../ports/tracked-url-summary.read-model';
import { ListTrackedUrlSummariesQuery } from './list-tracked-url-summaries.query';

class FakeTrackedUrlSummaryReadModel extends TrackedUrlSummaryReadModel {
  calls = 0;

  constructor(private readonly summaries: TrackedUrlSummary[]) {
    super();
  }

  listTracked(): Promise<TrackedUrlSummary[]> {
    this.calls += 1;
    return Promise.resolve(this.summaries);
  }
}

describe('ListTrackedUrlSummariesQuery', () => {
  it('renvoie les résumés des URLs suivies', async () => {
    const summaries: TrackedUrlSummary[] = [
      {
        id: 'aHR0cHM6Ly9leGFtcGxl',
        url: 'https://www.amazon.fr/dp/B0TEST0001',
        title: 'Lessive liquide 3L',
        image: null,
        price: { amount: 12.99, currency: 'EUR' },
        lastScrape: '2026-08-08T06:00:00.000Z',
      },
    ];
    const readModel = new FakeTrackedUrlSummaryReadModel(summaries);

    await expect(new ListTrackedUrlSummariesQuery(readModel).execute()).resolves.toBe(summaries);
    expect(readModel.calls).toBe(1);
  });

  it("supporte une URL jamais encore scrapée", async () => {
    const readModel = new FakeTrackedUrlSummaryReadModel([
      {
        id: 'aHR0cHM6Ly9leGFtcGxl',
        url: 'https://www.amazon.fr/dp/B0TEST0002',
        title: null,
        image: null,
        price: null,
        lastScrape: null,
      },
    ]);

    const [summary] = await new ListTrackedUrlSummariesQuery(readModel).execute();

    expect(summary).toMatchObject({ title: null, price: null, lastScrape: null });
  });
});

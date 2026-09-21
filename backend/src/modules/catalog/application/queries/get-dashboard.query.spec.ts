import { aProductSummary, EMPTY_DASHBOARD, FakeDashboardReadModel } from '../../testing/fakes';
import { GetDashboardQuery } from './get-dashboard.query';

describe('GetDashboardQuery', () => {
  it('renvoie le cliché du read model', async () => {
    const snapshot = {
      ...EMPTY_DASHBOARD,
      keywordCount: 2,
      productCount: 120,
      dealCount: 7,
      lastUpdate: '2026-08-08T06:00:00.000Z',
      dealsByKeyword: [
        {
          keyword: 'lessive',
          productCount: 80,
          totalDeals: 5,
          deals: [aProductSummary({ isDeal: true, dealScore: 32 })],
        },
      ],
    };
    const readModel = new FakeDashboardReadModel(snapshot);

    await expect(new GetDashboardQuery(readModel).execute()).resolves.toBe(snapshot);
    expect(readModel.calls).toBe(1);
  });

  it('supporte une base encore vide', async () => {
    const readModel = new FakeDashboardReadModel(EMPTY_DASHBOARD);

    await expect(new GetDashboardQuery(readModel).execute()).resolves.toMatchObject({
      keywordCount: 0,
      lastUpdate: null,
      dealsByKeyword: [],
    });
  });
});

import { InvalidStationSearch } from '../../domain/fuel.errors';
import { STALE_AFTER_HOURS } from '../../domain/freshness-policy';
import { aFuelPrice, aFuelStation, FakeFuelStationReadModel } from '../../testing/fakes';
import { SearchFuelStationsQuery } from './search-fuel-stations.query';

describe('SearchFuelStationsQuery', () => {
  const now = new Date('2026-10-26T12:00:00.000Z');
  const lyon = { lat: '45.7578', lng: '4.8320' };

  it('transmet une recherche validée au read model', async () => {
    const readModel = new FakeFuelStationReadModel();

    await new SearchFuelStationsQuery(readModel).execute({ ...lyon, fuel: 'e10' }, now);

    expect(readModel.calls[0]).toMatchObject({ latitude: 45.7578, fuel: 'e10', sort: 'distance' });
  });

  it('refuse une recherche invalide sans appeler le read model', async () => {
    const readModel = new FakeFuelStationReadModel();

    await expect(new SearchFuelStationsQuery(readModel).execute({ lat: '45' }, now)).rejects.toThrow(
      InvalidStationSearch,
    );
    expect(readModel.calls).toHaveLength(0);
  });

  it('juge la fraîcheur de chaque prix et sérialise les dates', async () => {
    const readModel = new FakeFuelStationReadModel({
      stations: [
        aFuelStation({
          fuels: [
            aFuelPrice({ code: 'gazole', updatedAt: new Date('2026-10-26T07:42:00.000Z') }),
            aFuelPrice({ code: 'e85', updatedAt: new Date('2026-10-20T07:00:00.000Z') }),
            aFuelPrice({
              code: 'gplc',
              price: null,
              updatedAt: null,
              available: false,
              shortageSince: new Date('2026-10-24T09:00:00.000Z'),
            }),
          ],
        }),
      ],
      truncated: true,
      lastImportAt: new Date('2026-10-26T10:00:00.000Z'),
    });

    const result = await new SearchFuelStationsQuery(readModel).execute(lyon, now);

    expect(result.truncated).toBe(true);
    expect(result.lastImportAt).toBe('2026-10-26T10:00:00.000Z');
    expect(result.staleAfterHours).toBe(STALE_AFTER_HOURS);
    expect(result.stations[0].fuels).toEqual([
      {
        code: 'gazole',
        price: 1.689,
        updatedAt: '2026-10-26T07:42:00.000Z',
        available: true,
        shortageSince: null,
        isStale: false,
      },
      expect.objectContaining({ code: 'e85', isStale: true }),
      {
        code: 'gplc',
        price: null,
        updatedAt: null,
        available: false,
        shortageSince: '2026-10-24T09:00:00.000Z',
        isStale: true,
      },
    ]);
  });

  it('une base vide donne une liste vide, pas une erreur', async () => {
    const result = await new SearchFuelStationsQuery(new FakeFuelStationReadModel()).execute(
      lyon,
      now,
    );

    expect(result).toMatchObject({ stations: [], truncated: false, lastImportAt: null });
  });
});

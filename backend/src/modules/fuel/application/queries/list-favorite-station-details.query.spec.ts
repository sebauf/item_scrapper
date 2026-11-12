import { UserId } from 'src/shared/domain/user-id';
import { STALE_AFTER_HOURS } from '../../domain/freshness-policy';
import { FORECAST_MAX_AGE_HOURS } from '../../domain/shortage-forecast-policy';
import {
  aFuelPrice,
  aFuelStation,
  FakeFuelStationReadModel,
  FakeRestockForecastReadModel,
  FakeShortageForecastReadModel,
} from '../../testing/fakes';
import { InMemoryFavoriteStationRepository } from '../../testing/in-memory-favorite-station.repository';
import { RestockForecastRow } from '../ports/restock-forecast.read-model';
import { ShortageForecastRow } from '../ports/shortage-forecast.read-model';
import { ListFavoriteStationDetailsQuery } from './list-favorite-station-details.query';

const alice = UserId.create('alice@example.com');
const now = new Date('2026-11-05T12:00:00.000Z');
const computedAt = new Date('2026-11-05T11:30:00.000Z');

function query(
  favorites: Record<string, Date>,
  stations = [aFuelStation()],
  forecasts: ShortageForecastRow[] = [],
  restocks: RestockForecastRow[] = [],
) {
  return new ListFavoriteStationDetailsQuery(
    new InMemoryFavoriteStationRepository(favorites),
    new FakeFuelStationReadModel({ stations, truncated: false, brands: [], lastImportAt: null }),
    new FakeShortageForecastReadModel(forecasts),
    new FakeRestockForecastReadModel(restocks),
  );
}

describe('ListFavoriteStationDetailsQuery', () => {
  it('assemble prix, fraîcheur et prévision de chaque carburant', async () => {
    const station = aFuelStation({
      id: '1',
      fuels: [
        aFuelPrice({ code: 'gazole', updatedAt: new Date('2026-11-05T07:00:00.000Z') }),
        aFuelPrice({ code: 'e10', updatedAt: new Date('2026-11-05T07:00:00.000Z') }),
      ],
    });

    const result = await query({ '1': new Date('2026-11-01T10:00:00.000Z') }, [station], [
      { stationId: '1', fuel: 'gazole', risk: 0.62, computedAt },
    ]).execute(alice, now);

    expect(result.stations).toHaveLength(1);
    const [view] = result.stations;
    expect(view).toMatchObject({ id: '1', addedAt: '2026-11-01T10:00:00.000Z' });
    expect(view.station).toMatchObject({ brand: 'TotalEnergies', city: 'Lyon' });
    expect(view.station).not.toHaveProperty('distanceKm');
    expect(view.station?.fuels).toEqual([
      {
        code: 'gazole',
        price: 1.689,
        updatedAt: '2026-11-05T07:00:00.000Z',
        available: true,
        shortageSince: null,
        isStale: false,
        shortageOutlook: {
          risk: 0.62,
          level: 'likely',
          computedAt: '2026-11-05T11:30:00.000Z',
          horizonEnd: '2026-11-06T11:30:00.000Z',
        },
        restockOutlook: null,
      },
      // Pas de prévision publiée pour l'E10 : on ne dit rien plutôt que « faible ».
      expect.objectContaining({ code: 'e10', shortageOutlook: null }),
    ]);
    expect(result.forecast.computedAt).toBe('2026-11-05T11:30:00.000Z');
    expect(result.staleAfterHours).toBe(STALE_AFTER_HOURS);
  });

  it('prévision de réapprovisionnement pour un carburant en rupture, pas pour un disponible', async () => {
    const station = aFuelStation({
      id: '1',
      fuels: [
        aFuelPrice({ code: 'gazole' }),
        aFuelPrice({
          code: 'e10',
          price: null,
          available: false,
          shortageSince: new Date('2026-11-05T09:00:00.000Z'),
        }),
      ],
    });

    const result = await query(
      { '1': now },
      [station],
      [],
      [
        { stationId: '1', fuel: 'gazole', probability: 0.9, computedAt },
        { stationId: '1', fuel: 'e10', probability: 0.34, computedAt },
      ],
    ).execute(alice, now);

    const [gazole, e10] = result.stations[0].station?.fuels ?? [];
    expect(gazole.restockOutlook).toBeNull();
    expect(e10).toMatchObject({
      shortageOutlook: null,
      restockOutlook: {
        probability: 0.34,
        level: 'possible',
        computedAt: '2026-11-05T11:30:00.000Z',
        horizonEnd: '2026-11-06T11:30:00.000Z',
      },
    });
    expect(result.restockForecast).toMatchObject({
      possibleThreshold: 0.2,
      likelyThreshold: 0.5,
      computedAt: '2026-11-05T11:30:00.000Z',
    });
    expect(result.forecast.computedAt).toBeNull();
  });

  it('pas de prévision de rupture pour un carburant déjà en rupture', async () => {
    const station = aFuelStation({
      id: '1',
      fuels: [
        aFuelPrice({
          code: 'gazole',
          price: null,
          available: false,
          shortageSince: new Date('2026-11-05T09:00:00.000Z'),
        }),
      ],
    });

    const result = await query({ '1': now }, [station], [
      { stationId: '1', fuel: 'gazole', risk: 0.9, computedAt },
    ]).execute(alice, now);

    expect(result.stations[0].station?.fuels[0]).toMatchObject({
      available: false,
      shortageSince: '2026-11-05T09:00:00.000Z',
      shortageOutlook: null,
    });
    expect(result.forecast.computedAt).toBeNull();
  });

  it('écarte une prévision trop ancienne', async () => {
    const old = new Date(now.getTime() - (FORECAST_MAX_AGE_HOURS + 1) * 3_600_000);

    const result = await query({ '69003001': now }, undefined, [
      { stationId: '69003001', fuel: 'gazole', risk: 0.3, computedAt: old },
    ]).execute(alice, now);

    expect(result.stations[0].station?.fuels[0].shortageOutlook).toBeNull();
  });

  it('garde une favorite sortie du flux, sans station', async () => {
    const result = await query({ '99999999': now }).execute(alice, now);

    expect(result.stations).toEqual([
      { id: '99999999', addedAt: now.toISOString(), station: null },
    ]);
  });

  it('suit l’ordre des favorites, la plus récente d’abord', async () => {
    const result = await query(
      { '1': new Date('2026-10-01T00:00:00.000Z'), '2': new Date('2026-10-20T00:00:00.000Z') },
      [aFuelStation({ id: '1' }), aFuelStation({ id: '2' })],
    ).execute(alice, now);

    expect(result.stations.map((s) => s.id)).toEqual(['2', '1']);
  });

  it('annonce la date de la prévision la plus récente, par modèle', async () => {
    const earlier = new Date('2026-11-05T11:00:00.000Z');
    const station = aFuelStation({
      id: '1',
      fuels: [
        aFuelPrice({ code: 'gazole' }),
        aFuelPrice({ code: 'e10' }),
        aFuelPrice({ code: 'sp98', price: null, available: false, shortageSince: earlier }),
      ],
    });

    const result = await query(
      { '1': new Date('2026-11-01T10:00:00.000Z') },
      [station],
      [
        { stationId: '1', fuel: 'gazole', risk: 0.2, computedAt: earlier },
        { stationId: '1', fuel: 'e10', risk: 0.4, computedAt },
      ],
      [{ stationId: '1', fuel: 'sp98', probability: 0.5, computedAt: earlier }],
    ).execute(alice, now);

    expect(result.forecast.computedAt).toBe('2026-11-05T11:30:00.000Z');
    expect(result.restockForecast.computedAt).toBe('2026-11-05T11:00:00.000Z');
  });

  it('aucune favorite : liste vide', async () => {
    const result = await query({}).execute(alice, now);

    expect(result.stations).toEqual([]);
    expect(result.forecast).toMatchObject({ horizonHours: 24, likelyThreshold: 0.5, computedAt: null });
    expect(result.restockForecast.computedAt).toBeNull();
  });
});

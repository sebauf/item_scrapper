import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { closeApp, createTestApp, jsonOf } from 'src/testing/http';
import { FuelStationReadModel, NearbyStations } from '../application/ports/fuel-station.read-model';
import { SearchFuelStationsQuery } from '../application/queries/search-fuel-stations.query';
import { aFuelStation, EMPTY_NEARBY, FakeFuelStationReadModel } from '../testing/fakes';
import { FuelStationController } from './fuel.controller';
import { FuelStationSearchResponse } from './dto/fuel-station.response';

describe('Fuel — API', () => {
  let app: NestFastifyApplication;
  let readModel: FakeFuelStationReadModel;

  async function start(result: NearbyStations = EMPTY_NEARBY) {
    readModel = new FakeFuelStationReadModel(result);
    app = await createTestApp({
      controllers: [FuelStationController],
      providers: [SearchFuelStationsQuery, { provide: FuelStationReadModel, useValue: readModel }],
    });
  }

  afterEach(() => closeApp(app));

  it('GET /api/v1/fuel-stations renvoie les stations et leurs carburants', async () => {
    await start({
      stations: [aFuelStation()],
      truncated: false,
      lastImportAt: new Date('2026-10-26T10:00:00.000Z'),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/fuel-stations?lat=45.7578&lng=4.832&fuel=gazole&sort=price&radiusKm=5',
    });

    expect(response.statusCode).toBe(200);
    const body = jsonOf<FuelStationSearchResponse>(response);
    expect(body.lastImportAt).toBe('2026-10-26T10:00:00.000Z');
    expect(body.stations[0]).toMatchObject({
      id: '69003001',
      latitude: 45.75938,
      longitude: 4.85491,
      distanceKm: 1.234,
      fuels: [{ code: 'gazole', price: 1.689, available: true }],
    });
    expect(typeof body.stations[0].fuels[0].isStale).toBe('boolean');
    expect(readModel.calls[0]).toMatchObject({ fuel: 'gazole', sort: 'price', radiusKm: 5 });
  });

  it('400 sans position', async () => {
    await start();

    const response = await app.inject({ method: 'GET', url: '/api/v1/fuel-stations' });

    expect(response.statusCode).toBe(400);
    expect(jsonOf<{ code: string }>(response).code).toBe('INVALID_STATION_SEARCH');
  });

  it('400 sur un paramètre inconnu', async () => {
    await start();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/fuel-stations?lat=45&lng=4&carburant=e10',
    });

    expect(response.statusCode).toBe(400);
    expect(readModel.calls).toHaveLength(0);
  });
});

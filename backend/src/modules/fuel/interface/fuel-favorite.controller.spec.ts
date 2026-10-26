import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { closeApp, createTestApp, jsonOf } from 'src/testing/http';
import { AddFavoriteStationCommand } from '../application/commands/add-favorite-station.command';
import { RemoveFavoriteStationCommand } from '../application/commands/remove-favorite-station.command';
import { FuelStationReadModel } from '../application/ports/fuel-station.read-model';
import { ListFavoriteStationsQuery } from '../application/queries/list-favorite-stations.query';
import { SearchFuelStationsQuery } from '../application/queries/search-fuel-stations.query';
import { FavoriteStationRepository } from '../domain/favorite-station.repository';
import { aFuelStation, FakeFuelStationReadModel } from '../testing/fakes';
import { InMemoryFavoriteStationRepository } from '../testing/in-memory-favorite-station.repository';
import { FuelFavoriteController } from './fuel-favorite.controller';
import { FuelStationController } from './fuel.controller';

/**
 * Les stations favorites sont un bouton étoile : PUT et DELETE idempotents.
 * Seule une station connue du flux peut devenir favorite.
 */
describe('Fuel favorites — API', () => {
  let app: NestFastifyApplication;
  let favorites: InMemoryFavoriteStationRepository;

  async function start(initial: Record<string, Date> = {}) {
    favorites = new InMemoryFavoriteStationRepository(initial);
    app = await createTestApp({
      // Les deux contrôleurs, comme dans FuelModule : `favorites` ne doit pas
      // être capturé par une route de recherche.
      controllers: [FuelFavoriteController, FuelStationController],
      providers: [
        AddFavoriteStationCommand,
        RemoveFavoriteStationCommand,
        ListFavoriteStationsQuery,
        SearchFuelStationsQuery,
        { provide: FavoriteStationRepository, useValue: favorites },
        {
          provide: FuelStationReadModel,
          useValue: new FakeFuelStationReadModel({
            stations: [aFuelStation({ id: '69003001' })],
            truncated: false,
            lastImportAt: null,
          }),
        },
      ],
    });
  }

  afterEach(() => closeApp(app));

  it('GET liste les favorites, la plus récente d’abord', async () => {
    await start({
      '1': new Date('2026-10-01T10:00:00.000Z'),
      '2': new Date('2026-10-20T10:00:00.000Z'),
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/fuel-stations/favorites' });

    expect(response.statusCode).toBe(200);
    expect(jsonOf<unknown>(response)).toEqual([
      { id: '2', addedAt: '2026-10-20T10:00:00.000Z' },
      { id: '1', addedAt: '2026-10-01T10:00:00.000Z' },
    ]);
  });

  it('PUT met une station en favori, et le reste au second appel', async () => {
    await start();

    for (let i = 0; i < 2; i++) {
      const response = await app.inject({ method: 'PUT', url: '/api/v1/fuel-stations/favorites/69003001' });
      expect(response.statusCode).toBe(204);
    }

    expect((await favorites.list()).map((f) => f.stationId)).toEqual(['69003001']);
  });

  it('PUT refuse une station absente du flux (404)', async () => {
    await start();

    const response = await app.inject({ method: 'PUT', url: '/api/v1/fuel-stations/favorites/99999999' });

    expect(response.statusCode).toBe(404);
    expect(jsonOf<{ code: string }>(response).code).toBe('FUEL_STATION_NOT_FOUND');
    expect(await favorites.list()).toEqual([]);
  });

  it('PUT refuse un identifiant mal formé (400)', async () => {
    await start();

    const response = await app.inject({ method: 'PUT', url: '/api/v1/fuel-stations/favorites/abc' });

    expect(response.statusCode).toBe(400);
    expect(jsonOf<{ code: string }>(response).code).toBe('INVALID_STATION_ID');
  });

  it('DELETE retire la favorite, même si la station a quitté le flux', async () => {
    await start({ '12345678': new Date() });

    const first = await app.inject({ method: 'DELETE', url: '/api/v1/fuel-stations/favorites/12345678' });
    const again = await app.inject({ method: 'DELETE', url: '/api/v1/fuel-stations/favorites/12345678' });

    expect([first.statusCode, again.statusCode]).toEqual([204, 204]);
    expect(await favorites.list()).toEqual([]);
  });

  it('la recherche signale les favorites', async () => {
    await start({ '69003001': new Date() });

    const response = await app.inject({ method: 'GET', url: '/api/v1/fuel-stations?lat=45.75&lng=4.83' });

    expect(jsonOf<{ stations: { isFavorite: boolean }[] }>(response).stations[0].isFavorite).toBe(true);
  });
});

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ALICE, BOB, authAs, closeApp, createTestApp, jsonOf } from 'src/testing/http';
import { FavoriteStationRepository } from '../../fuel/domain/favorite-station.repository';
import { InMemoryFavoriteStationRepository } from '../../fuel/testing/in-memory-favorite-station.repository';
import { UpdateProfileCommand } from '../application/commands/update-profile.command';
import { GetProfileQuery } from '../application/queries/get-profile.query';
import { UserProfileRepository } from '../domain/user-profile.repository';
import { InMemoryUserProfileRepository } from '../testing/in-memory-user-profile.repository';
import { ProfileController } from './profile.controller';

/**
 * Le profil est celui du jeton : pas d'identifiant dans l'URL, donc aucun
 * chemin vers le profil d'un autre compte.
 */
describe('Profile — API', () => {
  let app: NestFastifyApplication;
  let profiles: InMemoryUserProfileRepository;

  async function start(favorites: Record<string, Date> = {}) {
    profiles = new InMemoryUserProfileRepository();
    app = await createTestApp({
      controllers: [ProfileController],
      providers: [
        GetProfileQuery,
        UpdateProfileCommand,
        { provide: UserProfileRepository, useValue: profiles },
        { provide: FavoriteStationRepository, useValue: new InMemoryFavoriteStationRepository(favorites) },
      ],
    });
  }

  function put(body: unknown, user = ALICE) {
    return app.inject({
      headers: { ...authAs(user), 'content-type': 'application/json' },
      method: 'PUT',
      url: '/api/v1/profile',
      payload: JSON.stringify(body),
    });
  }

  afterEach(() => closeApp(app));

  it('GET renvoie un profil vide pour un nouvel utilisateur, alertes inactives', async () => {
    await start();

    const response = await app.inject({ headers: authAs(), method: 'GET', url: '/api/v1/profile' });

    expect(response.statusCode).toBe(200);
    expect(jsonOf<unknown>(response)).toEqual({
      email: 'alice@example.com',
      phone: null,
      alertFuels: [],
      favoriteStationCount: 0,
      fuelAlerts: { active: false, missing: ['phone', 'fuels', 'stations'] },
    });
  });

  it('PUT enregistre le numéro normalisé et active l’alerte quand une station est favorite', async () => {
    await start({ '69003001': new Date() });

    const response = await put({ phone: '06 12 34 56 78', alertFuels: ['sp98', 'gazole'] });

    expect(response.statusCode).toBe(200);
    expect(jsonOf<unknown>(response)).toMatchObject({
      phone: '+33612345678',
      alertFuels: ['gazole', 'sp98'],
      favoriteStationCount: 1,
      fuelAlerts: { active: true, missing: [] },
    });
    const stored = await profiles.find(ALICE);
    expect(stored.phone?.value).toBe('+33612345678');
  });

  it('PUT phone null efface le numéro et coupe l’alerte', async () => {
    await start({ '69003001': new Date() });
    await put({ phone: '0612345678', alertFuels: ['gazole'] });

    const response = await put({ phone: null, alertFuels: ['gazole'] });

    expect(jsonOf<{ phone: unknown; fuelAlerts: unknown }>(response)).toMatchObject({
      phone: null,
      fuelAlerts: { active: false, missing: ['phone'] },
    });
  });

  it('chaque utilisateur a son propre profil', async () => {
    await start();
    await put({ phone: '0612345678', alertFuels: ['gazole'] }, BOB);

    const alice = await app.inject({ headers: authAs(ALICE), method: 'GET', url: '/api/v1/profile' });

    expect(jsonOf<{ phone: unknown }>(alice).phone).toBeNull();
    expect((await profiles.find(BOB)).phone?.value).toBe('+33612345678');
  });

  it.each([
    [{ phone: '1234', alertFuels: [] }, 'INVALID_PHONE_NUMBER'],
    [{ phone: null, alertFuels: ['diesel'] }, 'INVALID_ALERT_FUELS'],
  ])('PUT %p → 400 %s, rien n’est enregistré', async (body, code) => {
    await start();

    const response = await put(body);

    expect(response.statusCode).toBe(400);
    expect(jsonOf<{ code: string }>(response).code).toBe(code);
    expect(profiles.store.size).toBe(0);
  });

  it.each([
    [{ alertFuels: [] }], // phone absent
    [{ phone: '0612345678' }], // alertFuels absent
    [{ phone: '0612345678', alertFuels: [], userId: 'bob@example.com' }], // champ inconnu
  ])('PUT refuse un corps mal formé %p (400)', async (body) => {
    await start();

    expect((await put(body)).statusCode).toBe(400);
    expect(profiles.store.size).toBe(0);
  });

  it('exige un jeton (401)', async () => {
    await start();

    const response = await app.inject({ method: 'GET', url: '/api/v1/profile' });

    expect(response.statusCode).toBe(401);
  });
});

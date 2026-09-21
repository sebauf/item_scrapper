import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { closeApp, createTestApp, jsonOf } from 'src/testing/http';
import { ProductReadModel } from '../../catalog/application/ports/product.read-model';
import { ProductId } from '../../catalog/domain/product-id';
import { aProductDetail, FakeProductReadModel } from '../../catalog/testing/fakes';
import { TrackProductUrlCommand } from '../../product-tracking/application/commands/track-product-url.command';
import { TrackedUrlRepository } from '../../product-tracking/domain/tracked-url.repository';
import { InMemoryTrackedUrlRepository } from '../../product-tracking/testing/in-memory-tracked-url.repository';
import { AddFavoriteCommand } from '../application/commands/add-favorite.command';
import { RemoveFavoriteCommand } from '../application/commands/remove-favorite.command';
import { IsFavoriteQuery } from '../application/queries/is-favorite.query';
import { ListFavoritesQuery } from '../application/queries/list-favorites.query';
import { FavoriteRepository } from '../domain/favorite.repository';
import { InMemoryFavoriteRepository } from '../testing/in-memory-favorite.repository';
import { FavoriteController } from './favorite.controller';

/**
 * Les favoris sont un bouton étoile : POST et DELETE sont idempotents, et
 * mettre en favori suit aussi l'URL pour garantir la continuité du relevé de
 * prix. Ces deux comportements sont l'objet des tests ci-dessous.
 */
describe('Favorite — API', () => {
  const url = 'https://www.amazon.fr/dp/B0TEST0001/';
  const encodedId = ProductId.fromUrl(url).value;

  let app: NestFastifyApplication;
  let favorites: InMemoryFavoriteRepository;
  let trackedUrls: InMemoryTrackedUrlRepository;

  async function start(
    initialFavorites: Record<string, Date> = {},
    initialTracked: Record<string, boolean> = {},
  ) {
    favorites = new InMemoryFavoriteRepository(initialFavorites);
    trackedUrls = new InMemoryTrackedUrlRepository(initialTracked);
    app = await createTestApp({
      controllers: [FavoriteController],
      providers: [
        AddFavoriteCommand,
        RemoveFavoriteCommand,
        ListFavoritesQuery,
        IsFavoriteQuery,
        TrackProductUrlCommand,
        { provide: FavoriteRepository, useValue: favorites },
        { provide: TrackedUrlRepository, useValue: trackedUrls },
        {
          provide: ProductReadModel,
          useValue: new FakeProductReadModel({ [url]: aProductDetail({ url }) }),
        },
      ],
    });
  }

  afterEach(() => closeApp(app));

  describe('GET /api/v1/favorites', () => {
    it('renvoie la fiche complète de chaque favori', async () => {
      await start({ [url]: new Date('2026-08-08T10:00:00.000Z') });

      const response = await app.inject({ method: 'GET', url: '/api/v1/favorites' });

      expect(response.statusCode).toBe(200);
      const [product] = jsonOf<{ url: string; history: unknown[] }[]>(response);
      expect(product.url).toBe(url);
      expect(product).toHaveProperty('history');
    });

    it('omet un favori dont aucun relevé n’existe encore', async () => {
      // Un produit tout juste favorisé peut n'avoir pas encore été scrapé : il
      // doit disparaître de la liste, pas casser la page.
      await start({ 'https://www.amazon.fr/dp/B0INCONNU1/': new Date() });

      const response = await app.inject({ method: 'GET', url: '/api/v1/favorites' });

      expect(response.statusCode).toBe(200);
      expect(jsonOf<unknown[]>(response)).toEqual([]);
    });

    it('renvoie une liste vide quand il n’y a pas de favori', async () => {
      await start();

      expect(jsonOf<unknown[]>(await app.inject({ method: 'GET', url: '/api/v1/favorites' }))).toEqual([]);
    });
  });

  describe('GET /api/v1/favorites/:id', () => {
    it('indique si un produit est en favori', async () => {
      await start({ [url]: new Date() });

      const response = await app.inject({ method: 'GET', url: `/api/v1/favorites/${encodedId}` });

      expect(response.statusCode).toBe(200);
      expect(jsonOf<{ isFavorite: boolean }>(response)).toEqual({ isFavorite: true });
    });

    it('répond false pour un produit qui ne l’est pas', async () => {
      await start();

      const response = await app.inject({ method: 'GET', url: `/api/v1/favorites/${encodedId}` });

      expect(jsonOf<{ isFavorite: boolean }>(response)).toEqual({ isFavorite: false });
    });

    it('refuse un identifiant mal formé', async () => {
      await start();

      const response = await app.inject({ method: 'GET', url: '/api/v1/favorites/pas-du-base64!!' });

      expect(response.statusCode).toBe(400);
      expect(jsonOf<{ code: string }>(response).code).toBe('INVALID_PRODUCT_ID');
    });
  });

  describe('POST /api/v1/favorites', () => {
    it('met en favori et met l’URL sous suivi', async () => {
      await start();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/favorites',
        payload: { id: encodedId },
      });

      expect(response.statusCode).toBe(201);
      await expect(favorites.isFavorite(url)).resolves.toBe(true);
      expect(trackedUrls.stateOf(url)).toBe(true);
    });

    it('est idempotent : refavoriser n’est pas un conflit', async () => {
      await start({ [url]: new Date() }, { [url]: true });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/favorites',
        payload: { id: encodedId },
      });

      // 409 serait le comportement de POST /product-urls ; pas celui d'un
      // bouton étoile, qu'un double-clic ne doit pas mettre en erreur.
      expect(response.statusCode).toBe(201);
      await expect(favorites.isFavorite(url)).resolves.toBe(true);
    });

    it('refuse un identifiant mal formé', async () => {
      await start();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/favorites',
        payload: { id: 'pas-du-base64!!' },
      });

      expect(response.statusCode).toBe(400);
      expect(jsonOf<{ code: string }>(response).code).toBe('INVALID_PRODUCT_ID');
    });
  });

  describe('DELETE /api/v1/favorites/:id', () => {
    it('retire des favoris', async () => {
      await start({ [url]: new Date() });

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/v1/favorites/${encodedId}`,
      });

      expect(response.statusCode).toBe(204);
      await expect(favorites.isFavorite(url)).resolves.toBe(false);
    });

    it('est idempotent : retirer un non-favori réussit', async () => {
      await start();

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/v1/favorites/${encodedId}`,
      });

      expect(response.statusCode).toBe(204);
    });

    it('ne retire pas l’URL du suivi — l’historique de prix continue', async () => {
      await start({ [url]: new Date() }, { [url]: true });

      await app.inject({ method: 'DELETE', url: `/api/v1/favorites/${encodedId}` });

      expect(trackedUrls.stateOf(url)).toBe(true);
    });
  });
});

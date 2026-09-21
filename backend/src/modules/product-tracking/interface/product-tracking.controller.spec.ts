import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { closeApp, createTestApp, jsonOf } from 'src/testing/http';
import { ProductId } from '../../catalog/domain/product-id';
import { TrackProductUrlCommand } from '../application/commands/track-product-url.command';
import { UntrackProductUrlCommand } from '../application/commands/untrack-product-url.command';
import { ListTrackedUrlSummariesQuery } from '../application/queries/list-tracked-url-summaries.query';
import {
  TrackedUrlSummary,
  TrackedUrlSummaryReadModel,
} from '../application/ports/tracked-url-summary.read-model';
import { TrackedUrlRepository } from '../domain/tracked-url.repository';
import { InMemoryTrackedUrlRepository } from '../testing/in-memory-tracked-url.repository';
import { ProductTrackingController } from './product-tracking.controller';

class FakeTrackedUrlSummaryReadModel extends TrackedUrlSummaryReadModel {
  constructor(private readonly summaries: TrackedUrlSummary[] = []) {
    super();
  }

  listTracked(): Promise<TrackedUrlSummary[]> {
    return Promise.resolve(this.summaries);
  }
}

/**
 * Miroir de Keyword — API, avec deux particularités propres au suivi d'URL :
 * la canonicalisation (toute variante d'une même fiche produit doit atterrir
 * sur la même clé) et le DELETE par identifiant encodé plutôt que par URL.
 */
describe('Product tracking — API', () => {
  const CANONICAL = 'https://www.amazon.fr/dp/B0TEST0001/';

  let app: NestFastifyApplication;
  let repository: InMemoryTrackedUrlRepository;

  async function start(initial: Record<string, boolean> = {}, summaries: TrackedUrlSummary[] = []) {
    repository = new InMemoryTrackedUrlRepository(initial);
    app = await createTestApp({
      controllers: [ProductTrackingController],
      providers: [
        TrackProductUrlCommand,
        UntrackProductUrlCommand,
        ListTrackedUrlSummariesQuery,
        { provide: TrackedUrlRepository, useValue: repository },
        {
          provide: TrackedUrlSummaryReadModel,
          useValue: new FakeTrackedUrlSummaryReadModel(summaries),
        },
      ],
    });
  }

  afterEach(() => closeApp(app));

  describe('GET /api/v1/product-urls', () => {
    it('renvoie les URLs suivies', async () => {
      await start({}, [
        {
          id: ProductId.fromUrl(CANONICAL).value,
          url: CANONICAL,
          title: 'Lessive liquide 3L',
          image: null,
          price: { amount: 12.99, currency: 'EUR' },
          lastScrape: '2026-08-08T06:00:00.000Z',
        },
      ]);

      const response = await app.inject({ method: 'GET', url: '/api/v1/product-urls' });

      expect(response.statusCode).toBe(200);
      expect(jsonOf<TrackedUrlSummary[]>(response)[0].url).toBe(CANONICAL);
    });
  });

  describe('POST /api/v1/product-urls', () => {
    it('suit une nouvelle URL', async () => {
      await start();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/product-urls',
        payload: { url: CANONICAL },
      });

      expect(response.statusCode).toBe(201);
      expect(repository.stateOf(CANONICAL)).toBe(true);
    });

    it('canonicalise avant de suivre', async () => {
      // Une URL collée depuis le navigateur porte du tracking et un slug : elle
      // doit rejoindre l'historique du même produit, pas en créer un second.
      await start();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/product-urls',
        payload: { url: 'https://www.amazon.fr/Lessive-liquide/dp/b0test0001/ref=sr_1_3?keywords=x' },
      });

      expect(response.statusCode).toBe(201);
      expect(repository.stateOf(CANONICAL)).toBe(true);
    });

    it.each([
      ['une URL non amazon', 'https://www.fnac.com/dp/B0TEST0001'],
      ['une page qui n’est pas une fiche produit', 'https://www.amazon.fr/s?k=lessive'],
      ['une URL mal formée', 'pas-une-url'],
      ['une chaîne vide', '   '],
    ])('refuse %s', async (_label, url) => {
      await start();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/product-urls',
        payload: { url },
      });

      expect(response.statusCode).toBe(400);
      expect(jsonOf<{ code: string }>(response).code).toBe('INVALID_PRODUCT_URL');
    });

    it('refuse une URL déjà suivie', async () => {
      await start({ [CANONICAL]: true });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/product-urls',
        payload: { url: CANONICAL },
      });

      expect(response.statusCode).toBe(409);
      expect(jsonOf<{ code: string }>(response).code).toBe('PRODUCT_URL_ALREADY_TRACKED');
    });

    it('réactive une URL précédemment retirée', async () => {
      await start({ [CANONICAL]: false });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/product-urls',
        payload: { url: CANONICAL },
      });

      expect(response.statusCode).toBe(201);
      expect(repository.stateOf(CANONICAL)).toBe(true);
    });
  });

  describe('DELETE /api/v1/product-urls/:id', () => {
    it('retire une URL suivie, désignée par son identifiant encodé', async () => {
      await start({ [CANONICAL]: true });

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/v1/product-urls/${ProductId.fromUrl(CANONICAL).value}`,
      });

      expect(response.statusCode).toBe(204);
      expect(repository.stateOf(CANONICAL)).toBe(false);
    });

    it('refuse un identifiant mal formé', async () => {
      await start();

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/product-urls/pas-du-base64!!',
      });

      expect(response.statusCode).toBe(400);
      expect(jsonOf<{ code: string }>(response).code).toBe('INVALID_PRODUCT_ID');
    });

    it('signale une URL inconnue', async () => {
      await start();

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/v1/product-urls/${ProductId.fromUrl(CANONICAL).value}`,
      });

      expect(response.statusCode).toBe(404);
      expect(jsonOf<{ code: string }>(response).code).toBe('PRODUCT_URL_NOT_FOUND');
    });
  });
});

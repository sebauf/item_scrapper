import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ProductNotFound } from '../domain/catalog.errors';
import { ProductId } from '../domain/product-id';
import { DashboardReadModel } from '../application/ports/dashboard.read-model';
import { ProductReadModel } from '../application/ports/product.read-model';
import { GetDashboardQuery } from '../application/queries/get-dashboard.query';
import { GetProductDetailQuery } from '../application/queries/get-product-detail.query';
import { SearchProductsQuery } from '../application/queries/search-products.query';
import {
  aProductDetail,
  aProductSummary,
  EMPTY_DASHBOARD,
  FakeDashboardReadModel,
  FakeProductReadModel,
} from '../testing/fakes';
import { closeApp, createTestApp, jsonOf } from 'src/testing/http';
import { DashboardController, KeywordProductsController, ProductController } from './catalog.controller';

/**
 * Tests d'API : l'application Fastify est réellement montée, avec le préfixe,
 * la validation et le filtre d'erreurs de production (cf. app-setup.ts). Seuls
 * les read models sont des doubles — aucune base n'est nécessaire.
 *
 * Ce qui se vérifie ici et nulle part ailleurs : les codes de statut, le
 * refus d'un paramètre inconnu, et le fait que le contrat de sortie ne perde
 * aucun champ à la sérialisation.
 */
describe('Catalog — API', () => {
  const url = 'https://www.amazon.fr/dp/B0TEST0001';
  const encodedId = ProductId.fromUrl(url).value;

  let app: NestFastifyApplication;
  let products: FakeProductReadModel;

  async function start(readModel: FakeProductReadModel, dashboard = EMPTY_DASHBOARD) {
    products = readModel;
    app = await createTestApp({
      controllers: [DashboardController, KeywordProductsController, ProductController],
      providers: [
        GetDashboardQuery,
        GetProductDetailQuery,
        SearchProductsQuery,
        { provide: ProductReadModel, useValue: readModel },
        { provide: DashboardReadModel, useValue: new FakeDashboardReadModel(dashboard) },
      ],
    });
    return app;
  }

  afterEach(() => closeApp(app));

  describe('GET /api/v1/dashboard', () => {
    it('renvoie les compteurs et les affaires par mot-clé', async () => {
      await start(new FakeProductReadModel(), {
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
      });

      const response = await app.inject({ method: 'GET', url: '/api/v1/dashboard' });

      expect(response.statusCode).toBe(200);
      expect(jsonOf<{ dealCount: number }>(response).dealCount).toBe(7);
      expect(jsonOf<{ dealsByKeyword: unknown[] }>(response).dealsByKeyword).toHaveLength(1);
    });

    it("n'est pas servi hors du préfixe de version", async () => {
      await start(new FakeProductReadModel());

      expect((await app.inject({ method: 'GET', url: '/dashboard' })).statusCode).toBe(404);
    });
  });

  describe('GET /api/v1/keywords/:keyword/products', () => {
    const result = {
      items: [aProductSummary({ url })],
      total: 1,
      pageCount: 1,
      keywordTotal: 12,
      keywordDealCount: 3,
    };

    it('renvoie la page de produits', async () => {
      await start(new FakeProductReadModel({}, result));

      const response = await app.inject({ method: 'GET', url: '/api/v1/keywords/lessive/products' });

      expect(response.statusCode).toBe(200);
      expect(jsonOf<typeof result>(response)).toEqual(result);
    });

    it('décode un mot-clé contenant un espace', async () => {
      await start(new FakeProductReadModel({}, result));

      await app.inject({ method: 'GET', url: '/api/v1/keywords/lessive%20liquide/products' });

      expect(products.searchCalls[0].keyword).toBe('lessive liquide');
    });

    it('transmet les filtres de la query string', async () => {
      await start(new FakeProductReadModel({}, result));

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/keywords/lessive/products?q=savon&deals=1&min=5&max=50&sort=price_asc&page=2',
      });

      expect(response.statusCode).toBe(200);
      expect(products.searchCalls[0].query).toMatchObject({
        search: 'savon',
        dealsOnly: true,
        minPrice: 5,
        maxPrice: 50,
        sort: 'price_asc',
        page: 2,
      });
    });

    it('refuse un paramètre inconnu plutôt que de l’ignorer', async () => {
      // Une faute de frappe (`&sorted=`) doit se voir tout de suite, sinon
      // l'utilisateur croit filtrer alors qu'il ne filtre pas.
      await start(new FakeProductReadModel({}, result));

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/keywords/lessive/products?sorted=price_asc',
      });

      expect(response.statusCode).toBe(400);
      expect(products.searchCalls).toHaveLength(0);
    });

    it('traduit un critère invalide en 400 avec un code stable', async () => {
      await start(new FakeProductReadModel({}, result));

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/keywords/lessive/products?sort=le-moins-cher',
      });

      expect(response.statusCode).toBe(400);
      expect(jsonOf<{ code: string }>(response).code).toBe('INVALID_PRODUCT_QUERY');
    });

    it('renvoie un résultat vide pour un mot-clé inconnu, pas une erreur', async () => {
      await start(new FakeProductReadModel());

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/keywords/inexistant/products',
      });

      expect(response.statusCode).toBe(200);
      expect(jsonOf<{ total: number }>(response).total).toBe(0);
    });
  });

  describe('GET /api/v1/products/:id', () => {
    it('renvoie la fiche complète', async () => {
      const detail = aProductDetail({
        url,
        history: [
          {
            day: '2026-08-07T00:00:00.000Z',
            price: { amount: 14.99, currency: 'EUR' },
            crossedOutPrice: null,
            unitPrice: null,
            scrapedAt: '2026-08-07T06:00:00.000Z',
          },
        ],
      });
      await start(new FakeProductReadModel({ [url]: detail }));

      const response = await app.inject({ method: 'GET', url: `/api/v1/products/${encodedId}` });

      expect(response.statusCode).toBe(200);
      expect(jsonOf<typeof detail>(response)).toEqual(detail);
    });

    it('conserve les champs à null — le frontend les teste avec !== null', async () => {
      await start(new FakeProductReadModel({ [url]: aProductDetail({ url }) }));

      const response = await app.inject({ method: 'GET', url: `/api/v1/products/${encodedId}` });
      const body = jsonOf<Record<string, unknown>>(response);

      expect(body).toHaveProperty('dealScore', null);
      expect(body).toHaveProperty('predictedPrice', null);
      expect(body).toHaveProperty('trendDirection', null);
    });

    it('renvoie 404 pour un produit inconnu', async () => {
      await start(new FakeProductReadModel());

      const response = await app.inject({ method: 'GET', url: `/api/v1/products/${encodedId}` });

      expect(response.statusCode).toBe(404);
      expect(jsonOf<{ code: string }>(response).code).toBe(new ProductNotFound().code);
    });

    it('renvoie 400 pour un identifiant mal formé', async () => {
      await start(new FakeProductReadModel());

      const response = await app.inject({ method: 'GET', url: '/api/v1/products/pas-du-base64!!' });

      expect(response.statusCode).toBe(400);
      expect(jsonOf<{ code: string }>(response).code).toBe('INVALID_PRODUCT_ID');
    });
  });
});

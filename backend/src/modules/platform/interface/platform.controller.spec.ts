import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppConfig } from 'src/config/app-config';
import { closeApp, createTestApp, jsonOf } from 'src/testing/http';
import { RedeployCommand } from '../application/commands/redeploy.command';
import { ClusterGateway, DeployedComponent } from '../application/ports/cluster.gateway';
import { ImageRegistry } from '../application/ports/image-registry';
import { GetUpdateStatusQuery } from '../application/queries/get-update-status.query';
import { aDeployedComponent, FakeClusterGateway, FakeImageRegistry } from '../testing/fakes';
import { AdminTokenGuard } from './admin-token.guard';
import { PlatformController } from './platform.controller';

/**
 * Le point sensible de ce contrôleur est le garde : une route qui redémarre
 * toute l'application ne doit répondre qu'au bon jeton. Les refus sont donc
 * testés avant le cas nominal.
 */
describe('Platform — API', () => {
  const ADMIN_TOKEN = 'jeton-admin-de-test-0123456789';
  const image = 'ghcr.io/owner/item_scrapper-backend:main';

  let app: NestFastifyApplication;
  let cluster: FakeClusterGateway;

  async function start(
    options: {
      components?: DeployedComponent[];
      digests?: Record<string, string>;
      clusterAvailable?: boolean;
      adminToken?: string;
    } = {},
  ) {
    cluster = new FakeClusterGateway(
      options.components ?? [aDeployedComponent({ image, runningDigest: 'sha256:old' })],
      options.clusterAvailable ?? true,
    );
    app = await createTestApp({
      controllers: [PlatformController],
      providers: [
        GetUpdateStatusQuery,
        RedeployCommand,
        AdminTokenGuard,
        { provide: ClusterGateway, useValue: cluster },
        { provide: ImageRegistry, useValue: new FakeImageRegistry(options.digests ?? { [image]: 'sha256:new' }) },
        {
          provide: AppConfig,
          useValue: AppConfig.fromEnv({
            MONGODB_URI: 'mongodb://localhost',
            ADMIN_TOKEN: 'adminToken' in options ? options.adminToken : ADMIN_TOKEN,
          }),
        },
      ],
    });
  }

  afterEach(() => closeApp(app));

  const redeploy = (authorization?: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/platform/redeploy',
      headers: authorization ? { authorization } : {},
    });

  describe('GET /api/v1/platform/status', () => {
    it('décrit chaque composant et signale la mise à jour disponible', async () => {
      await start();

      const response = await app.inject({ method: 'GET', url: '/api/v1/platform/status' });

      expect(response.statusCode).toBe(200);
      expect(jsonOf<Record<string, unknown>>(response)).toMatchObject({
        clusterAvailable: true,
        redeployEnabled: true,
        updateAvailable: true,
        rolloutInProgress: false,
        components: [
          {
            name: 'price-tracker-backend',
            image,
            status: 'outdated',
            runningDigest: 'sha256:old',
            latestDigest: 'sha256:new',
          },
        ],
      });
    });

    it('ne propose pas le bouton sans ADMIN_TOKEN', async () => {
      await start({ adminToken: undefined });

      const response = await app.inject({ method: 'GET', url: '/api/v1/platform/status' });

      expect(jsonOf<{ redeployEnabled: boolean }>(response).redeployEnabled).toBe(false);
    });

    it('répond sans erreur hors cluster', async () => {
      await start({ clusterAvailable: false });

      const response = await app.inject({ method: 'GET', url: '/api/v1/platform/status' });

      expect(response.statusCode).toBe(200);
      expect(jsonOf<Record<string, unknown>>(response)).toMatchObject({
        clusterAvailable: false,
        redeployEnabled: false,
        components: [],
      });
    });
  });

  describe('POST /api/v1/platform/redeploy', () => {
    it.each([
      ['sans en-tête', undefined],
      ['avec un mauvais jeton', 'Bearer mauvais-jeton-0123456789'],
      ['avec un autre schéma', `Basic ${ADMIN_TOKEN}`],
    ])('refuse %s (401), sans rien redémarrer', async (_label, authorization) => {
      await start();

      const response = await redeploy(authorization);

      expect(response.statusCode).toBe(401);
      expect(jsonOf<{ code: string }>(response).code).toBe('INVALID_ADMIN_TOKEN');
      expect(cluster.restarted).toEqual([]);
    });

    it('reste fermé sans ADMIN_TOKEN configuré (403), quel que soit l’en-tête', async () => {
      await start({ adminToken: undefined });

      const response = await redeploy('Bearer ');

      expect(response.statusCode).toBe(403);
      expect(jsonOf<{ code: string }>(response).code).toBe('ADMIN_DISABLED');
      expect(cluster.restarted).toEqual([]);
    });

    it('redémarre les composants en retard avec le bon jeton (202)', async () => {
      await start();

      const response = await redeploy(`Bearer ${ADMIN_TOKEN}`);

      expect(response.statusCode).toBe(202);
      expect(jsonOf<{ restarted: string[] }>(response)).toEqual({ restarted: ['price-tracker-backend'] });
      expect(cluster.restarted).toEqual([['price-tracker-backend']]);
    });

    it.each([
      ['déjà à jour', { digests: { [image]: 'sha256:old' } }, 'ALREADY_UP_TO_DATE'],
      ['un rollout en cours', { components: [aDeployedComponent({ rolloutInProgress: true })] }, 'ROLLOUT_IN_PROGRESS'],
      ['hors cluster', { clusterAvailable: false }, 'CLUSTER_UNAVAILABLE'],
    ])('répond 409 quand l’application est %s', async (_label, options, code) => {
      await start(options);

      const response = await redeploy(`Bearer ${ADMIN_TOKEN}`);

      expect(response.statusCode).toBe(409);
      expect(jsonOf<{ code: string }>(response).code).toBe(code);
      expect(cluster.restarted).toEqual([]);
    });
  });
});

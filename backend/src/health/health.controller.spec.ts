import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Db } from 'mongodb';
import { closeApp, createTestApp, jsonOf } from 'src/testing/http';
import { MONGO_DB } from 'src/shared/infrastructure/mongo/mongo.tokens';
import { HealthController } from './health.controller';

/**
 * Les deux sondes ne disent pas la même chose, et les confondre coûte cher :
 * `live` qui toucherait Mongo ferait redémarrer le pod en boucle pendant une
 * coupure base, sans rien réparer. Ces tests figent la séparation.
 *
 * Elles doivent aussi rester hors du préfixe `/api/v1` : les probes Kubernetes
 * (cf. k8s/base/backend-deployment.yaml) interrogent la racine.
 */
describe('Health — API', () => {
  let app: NestFastifyApplication;

  async function start(command: () => Promise<unknown>) {
    app = await createTestApp({
      controllers: [HealthController],
      providers: [{ provide: MONGO_DB, useValue: { command } as unknown as Db }],
    });
  }

  afterEach(() => closeApp(app));

  describe('GET /health/live', () => {
    it('répond sans jamais interroger la base', async () => {
      const command = jest.fn().mockRejectedValue(new Error('Mongo est tombé'));
      await start(command);

      const response = await app.inject({ method: 'GET', url: '/health/live' });

      expect(response.statusCode).toBe(200);
      expect(jsonOf<{ status: string }>(response)).toEqual({ status: 'ok' });
      expect(command).not.toHaveBeenCalled();
    });

    it('est servie hors du préfixe de version', async () => {
      await start(jest.fn().mockResolvedValue({ ok: 1 }));

      expect((await app.inject({ method: 'GET', url: '/api/v1/health/live' })).statusCode).toBe(404);
    });
  });

  describe('GET /health/ready', () => {
    it('pingue la base et la déclare joignable', async () => {
      const command = jest.fn().mockResolvedValue({ ok: 1 });
      await start(command);

      const response = await app.inject({ method: 'GET', url: '/health/ready' });

      expect(response.statusCode).toBe(200);
      expect(jsonOf<{ mongodb: string }>(response)).toEqual({ status: 'ok', mongodb: 'up' });
      expect(command).toHaveBeenCalledWith({ ping: 1 });
    });

    it('retire le pod du service quand la base est injoignable', async () => {
      await start(jest.fn().mockRejectedValue(new Error('connection refused')));

      const response = await app.inject({ method: 'GET', url: '/health/ready' });

      // 503 : Kubernetes sort le pod du service sans le tuer.
      expect(response.statusCode).toBe(503);
      expect(jsonOf<{ mongodb: string; message: string }>(response)).toMatchObject({
        mongodb: 'down',
        message: 'connection refused',
      });
    });

    it('supporte un échec qui n’est pas une Error', async () => {
      await start(jest.fn().mockRejectedValue('boom'));

      const response = await app.inject({ method: 'GET', url: '/health/ready' });

      expect(response.statusCode).toBe(503);
      expect(jsonOf<{ message: string }>(response).message).toBe('MongoDB injoignable');
    });
  });
});

import { INestApplication, ModuleMetadata } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { configureApp } from '../app-setup';
import { AppConfig } from '../config/app-config';
import { UserId } from '../shared/domain/user-id';
import { signInternalToken } from '../shared/infrastructure/auth/internal-token';

/** Secret des tests d'API — jamais utilisé ailleurs. */
export const TEST_AUTH_SECRET = 'test-secret-'.padEnd(48, 'x');

/** Utilisateur par défaut des tests d'API. */
export const ALICE = UserId.create('alice@example.com');
export const BOB = UserId.create('bob@example.com');

/**
 * En-têtes d'une requête authentifiée au nom de `user`, signée comme le ferait
 * le frontend.
 */
export function authAs(user: UserId = ALICE): { authorization: string } {
  return {
    authorization: `Bearer ${signInternalToken({ sub: user.value, iss: 'test' }, TEST_AUTH_SECRET)}`,
  };
}

/**
 * Monte une application Fastify réelle autour des seuls contrôleurs à tester,
 * avec la configuration HTTP de production (`configureApp`), garde
 * d'authentification comprise.
 *
 * L'intérêt par rapport à l'appel direct d'une méthode de contrôleur : la
 * validation des DTO, l'authentification, la sérialisation JSON, les codes de
 * statut et le filtre d'erreurs métier sont traversés pour de bon. Aucun module
 * d'infrastructure n'est chargé — donc aucune connexion Mongo, ce qui garde la
 * suite exécutable en CI sans service annexe.
 */
export async function createTestApp(metadata: ModuleMetadata): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    ...metadata,
    providers: [
      ...(metadata.providers ?? []),
      {
        provide: AppConfig,
        useValue: AppConfig.fromEnv({
          MONGODB_URI: 'mongodb://test',
          BACKEND_AUTH_SECRET: TEST_AUTH_SECRET,
        }),
      },
    ],
  }).compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

/** Corps JSON d'une réponse Fastify injectée, typé à l'appel. */
export function jsonOf<T>(response: { payload: string }): T {
  return JSON.parse(response.payload) as T;
}

export async function closeApp(app: INestApplication | undefined): Promise<void> {
  if (app) await app.close();
}

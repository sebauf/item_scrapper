import { INestApplication, ModuleMetadata } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { configureApp } from '../app-setup';

/**
 * Monte une application Fastify réelle autour des seuls contrôleurs à tester,
 * avec la configuration HTTP de production (`configureApp`).
 *
 * L'intérêt par rapport à l'appel direct d'une méthode de contrôleur : la
 * validation des DTO, la sérialisation JSON, les codes de statut et le filtre
 * d'erreurs métier sont traversés pour de bon. Aucun module d'infrastructure
 * n'est chargé — donc aucune connexion Mongo, ce qui garde la suite exécutable
 * en CI sans service annexe.
 */
export async function createTestApp(metadata: ModuleMetadata): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule(metadata).compile();

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

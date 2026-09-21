import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './app-setup';
import { AppConfig } from './config/app-config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  const config = app.get(AppConfig);

  // Préfixe, validation et traduction des erreurs métier : partagés avec les
  // tests d'API (cf. app-setup.ts).
  configureApp(app);

  // Le frontend appelle le backend côté serveur (dans le cluster) : aucune
  // origine navigateur n'est nécessaire en fonctionnement nominal.
  if (config.corsOrigins.length > 0) {
    app.enableCors({ origin: [...config.corsOrigins] });
  }

  // Permet à MongoModule.onApplicationShutdown de fermer proprement le client.
  app.enableShutdownHooks();

  SwaggerModule.setup(
    'docs',
    app,
    SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Price tracker API')
        .setDescription('Accès aux mots-clés suivis, aux produits et aux bonnes affaires')
        .setVersion('1.0')
        .build(),
    ),
    { jsonDocumentUrl: 'openapi.json' },
  );

  await app.listen(config.port, '0.0.0.0');
  new Logger('Bootstrap').log(`API prête sur http://0.0.0.0:${config.port} (docs: /docs)`);
}

void bootstrap();

import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AppConfig } from './config/app-config';
import { DomainExceptionFilter } from './shared/interface/http/domain-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  const config = app.get(AppConfig);

  // Toutes les routes métier sont versionnées ; les sondes restent à la racine
  // pour que les probes Kubernetes ne dépendent pas de la version d'API.
  app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready'] });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // retire les champs non déclarés dans le DTO
      forbidNonWhitelisted: true, // ... et refuse la requête s'il y en a
      transform: true, // instancie réellement la classe DTO
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new DomainExceptionFilter());

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

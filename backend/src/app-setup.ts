import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DomainExceptionFilter } from './shared/interface/http/domain-exception.filter';

/**
 * Configuration HTTP commune : préfixe, validation, traduction des erreurs
 * métier.
 *
 * Extraite de `main.ts` pour que les tests d'API montent *exactement* la même
 * chaîne que la production. Recopier ces réglages dans les tests reviendrait à
 * tester une configuration qui n'est pas celle qui tourne — un `whitelist`
 * désactivé par mégarde passerait alors inaperçu.
 */
export function configureApp(app: INestApplication): void {
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
}

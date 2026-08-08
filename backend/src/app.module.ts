import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { KeywordModule } from './modules/keyword/keyword.module';
import { MongoModule } from './shared/infrastructure/mongo/mongo.module';

/**
 * Racine de composition. Un module par contexte métier ; les deux premiers
 * imports sont de l'infrastructure transverse (globale).
 */
@Module({
  imports: [ConfigModule, MongoModule, HealthModule, KeywordModule, CatalogModule],
})
export class AppModule {}

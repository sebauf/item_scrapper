import { Module } from '@nestjs/common';
import { AppConfig } from 'src/config/app-config';
import { TrackProductUrlCommand } from './application/commands/track-product-url.command';
import { UntrackProductUrlCommand } from './application/commands/untrack-product-url.command';
import { TrackedUrlSummaryReadModel } from './application/ports/tracked-url-summary.read-model';
import { ListTrackedUrlSummariesQuery } from './application/queries/list-tracked-url-summaries.query';
import { TrackedUrlQuota } from './domain/tracked-url-quota';
import { TrackedUrlRepository } from './domain/tracked-url.repository';
import { MongoTrackedUrlSummaryReadModel } from './infrastructure/mongo-tracked-url-summary.read-model';
import { MongoTrackedUrlRepository } from './infrastructure/mongo-tracked-url.repository';
import { ProductTrackingController } from './interface/product-tracking.controller';

/**
 * Câblage du contexte product-tracking — miroir de KeywordModule.
 *
 * `TrackProductUrlCommand` est exportée : c'est elle que `FavoriteModule`
 * réutilise pour garantir la continuité du suivi d'un produit mis en favori.
 * `TrackedUrlSummaryReadModel` l'est aussi : le tableau de bord (Catalog) en
 * tire le périmètre « URLs suivies par l'utilisateur ».
 */
@Module({
  controllers: [ProductTrackingController],
  providers: [
    TrackProductUrlCommand,
    UntrackProductUrlCommand,
    ListTrackedUrlSummariesQuery,
    { provide: TrackedUrlRepository, useClass: MongoTrackedUrlRepository },
    {
      provide: TrackedUrlQuota,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => new TrackedUrlQuota(config.maxTrackedUrlsPerUser),
    },
    { provide: TrackedUrlSummaryReadModel, useClass: MongoTrackedUrlSummaryReadModel },
  ],
  exports: [TrackProductUrlCommand, TrackedUrlSummaryReadModel],
})
export class ProductTrackingModule {}

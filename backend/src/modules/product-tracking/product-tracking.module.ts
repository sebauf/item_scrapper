import { Module } from '@nestjs/common';
import { TrackProductUrlCommand } from './application/commands/track-product-url.command';
import { UntrackProductUrlCommand } from './application/commands/untrack-product-url.command';
import { TrackedUrlSummaryReadModel } from './application/ports/tracked-url-summary.read-model';
import { ListTrackedUrlSummariesQuery } from './application/queries/list-tracked-url-summaries.query';
import { TrackedUrlRepository } from './domain/tracked-url.repository';
import { MongoTrackedUrlSummaryReadModel } from './infrastructure/mongo-tracked-url-summary.read-model';
import { MongoTrackedUrlRepository } from './infrastructure/mongo-tracked-url.repository';
import { ProductTrackingController } from './interface/product-tracking.controller';

/**
 * Câblage du contexte product-tracking — miroir de KeywordModule.
 *
 * `TrackProductUrlCommand` est exportée : c'est elle que `FavoriteModule`
 * réutilise pour garantir la continuité du suivi d'un produit mis en favori.
 */
@Module({
  controllers: [ProductTrackingController],
  providers: [
    TrackProductUrlCommand,
    UntrackProductUrlCommand,
    ListTrackedUrlSummariesQuery,
    { provide: TrackedUrlRepository, useClass: MongoTrackedUrlRepository },
    { provide: TrackedUrlSummaryReadModel, useClass: MongoTrackedUrlSummaryReadModel },
  ],
  exports: [TrackProductUrlCommand],
})
export class ProductTrackingModule {}

import { Module } from '@nestjs/common';
import { TrackKeywordCommand } from './application/commands/track-keyword.command';
import { UntrackKeywordCommand } from './application/commands/untrack-keyword.command';
import { KeywordSummaryReadModel } from './application/ports/keyword-summary.read-model';
import { ScrapedKeywords } from './application/ports/scraped-keywords';
import { ListKeywordSummariesQuery } from './application/queries/list-keyword-summaries.query';
import { KeywordRepository } from './domain/keyword.repository';
import { MongoKeywordSummaryReadModel } from './infrastructure/mongo-keyword-summary.read-model';
import { MongoScrapedKeywords } from './infrastructure/mongo-scraped-keywords';
import { MongoKeywordRepository } from './infrastructure/mongo-keyword.repository';
import { KeywordController } from './interface/keyword.controller';

/**
 * Câblage du contexte Keyword : c'est ici, et nulle part ailleurs, qu'on décide
 * que les ports du domaine sont satisfaits par des implémentations MongoDB.
 * Remplacer Mongo par autre chose ne toucherait que ces lignes `useClass`.
 */
@Module({
  controllers: [KeywordController],
  providers: [
    TrackKeywordCommand,
    UntrackKeywordCommand,
    ListKeywordSummariesQuery,
    { provide: KeywordRepository, useClass: MongoKeywordRepository },
    { provide: KeywordSummaryReadModel, useClass: MongoKeywordSummaryReadModel },
    { provide: ScrapedKeywords, useClass: MongoScrapedKeywords },
  ],
  // KeywordSummaryReadModel : le tableau de bord (CatalogModule) s'en sert pour
  // compter les mots-clés suivis selon la même règle que la page qui les liste.
  exports: [KeywordSummaryReadModel],
})
export class KeywordModule {}

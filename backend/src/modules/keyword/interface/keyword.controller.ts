import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TrackKeywordCommand } from '../application/commands/track-keyword.command';
import { UntrackKeywordCommand } from '../application/commands/untrack-keyword.command';
import { ListKeywordSummariesQuery } from '../application/queries/list-keyword-summaries.query';
import { KeywordSummaryResponse } from './dto/keyword-summary.response';
import { TrackKeywordDto } from './dto/track-keyword.dto';

/**
 * Adaptateur HTTP du contexte Keyword.
 *
 * Son travail se limite à : traduire la requête en appel de use case, et le
 * résultat en réponse. Aucune règle, aucun accès base. Les erreurs métier
 * remontent telles quelles et sont converties par DomainExceptionFilter.
 */
@ApiTags('keywords')
@Controller('keywords')
export class KeywordController {
  constructor(
    private readonly trackKeyword: TrackKeywordCommand,
    private readonly untrackKeyword: UntrackKeywordCommand,
    private readonly listSummaries: ListKeywordSummariesQuery,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Mots-clés suivis, avec nombre de produits et dernier scrape' })
  @ApiResponse({ status: 200, type: [KeywordSummaryResponse] })
  async list(): Promise<KeywordSummaryResponse[]> {
    const summaries = await this.listSummaries.execute();
    return summaries.map(KeywordSummaryResponse.from);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Suivre un nouveau mot-clé (ou réactiver un mot-clé retiré)' })
  @ApiResponse({ status: 201, description: 'Mot-clé suivi' })
  @ApiResponse({ status: 400, description: 'Nom vide ou trop long' })
  @ApiResponse({ status: 409, description: 'Mot-clé déjà suivi' })
  async track(@Body() dto: TrackKeywordDto): Promise<void> {
    await this.trackKeyword.execute(dto.keyword);
  }

  @Delete(':keyword')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Retirer un mot-clé du suivi' })
  @ApiParam({ name: 'keyword', example: 'lessive%20liquide' })
  @ApiResponse({ status: 204, description: 'Mot-clé retiré' })
  @ApiResponse({ status: 404, description: 'Mot-clé inconnu' })
  async untrack(@Param('keyword') keyword: string): Promise<void> {
    await this.untrackKeyword.execute(keyword);
  }
}

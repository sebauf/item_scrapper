import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ProductId } from '../../catalog/domain/product-id';
import { TrackProductUrlCommand } from '../application/commands/track-product-url.command';
import { UntrackProductUrlCommand } from '../application/commands/untrack-product-url.command';
import { ListTrackedUrlSummariesQuery } from '../application/queries/list-tracked-url-summaries.query';
import { TrackProductUrlDto } from './dto/track-product-url.dto';
import { TrackedUrlSummaryResponse } from './dto/tracked-url-summary.response';

/**
 * Adaptateur HTTP du contexte product-tracking — miroir de KeywordController.
 *
 * `DELETE` prend l'identifiant encodé (`ProductId`), pas l'URL en clair :
 * une URL porte des `/` qui voyagent mal dans un chemin HTTP, cf. le
 * commentaire de `ProductId`.
 */
@ApiTags('product-urls')
@Controller('product-urls')
export class ProductTrackingController {
  constructor(
    private readonly trackProductUrl: TrackProductUrlCommand,
    private readonly untrackProductUrl: UntrackProductUrlCommand,
    private readonly listSummaries: ListTrackedUrlSummariesQuery,
  ) {}

  @Get()
  @ApiOperation({ summary: 'URLs suivies individuellement, avec dernier prix connu' })
  @ApiResponse({ status: 200, type: [TrackedUrlSummaryResponse] })
  async list(): Promise<TrackedUrlSummaryResponse[]> {
    const summaries = await this.listSummaries.execute();
    return summaries.map(TrackedUrlSummaryResponse.from);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Suivre une URL produit (ou réactiver une URL retirée)' })
  @ApiResponse({ status: 201, description: 'URL suivie' })
  @ApiResponse({ status: 400, description: 'URL absente ou non reconnue comme fiche produit amazon.fr' })
  @ApiResponse({ status: 409, description: 'URL déjà suivie' })
  async track(@Body() dto: TrackProductUrlDto): Promise<void> {
    await this.trackProductUrl.execute(dto.url);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Retirer une URL du suivi individuel' })
  @ApiParam({ name: 'id', description: 'Identifiant encodé renvoyé par la liste' })
  @ApiResponse({ status: 204, description: 'URL retirée' })
  @ApiResponse({ status: 400, description: 'Identifiant mal formé' })
  @ApiResponse({ status: 404, description: 'URL inconnue' })
  async untrack(@Param('id') id: string): Promise<void> {
    const url = ProductId.fromEncoded(id).url;
    await this.untrackProductUrl.execute(url);
  }
}

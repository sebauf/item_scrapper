import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserId } from 'src/shared/domain/user-id';
import { CurrentUser } from 'src/shared/interface/http/auth.guard';
import { AddFavoriteStationCommand } from '../application/commands/add-favorite-station.command';
import { RemoveFavoriteStationCommand } from '../application/commands/remove-favorite-station.command';
import { ListFavoriteStationDetailsQuery } from '../application/queries/list-favorite-station-details.query';
import { ListFavoriteStationsQuery } from '../application/queries/list-favorite-stations.query';
import {
  FavoriteStationDetailsListResponse,
  FavoriteStationResponse,
} from './dto/fuel-station.response';

/**
 * Stations favorites. `PUT`/`DELETE` sur l'identifiant, idempotents (204
 * dans tous les cas) : c'est un bouton étoile, et l'identifiant officiel est
 * une simple suite de chiffres, sûre dans un chemin — contrairement aux
 * produits, dont l'identifiant encode une URL et voyage dans un corps POST.
 */
@ApiBearerAuth()
@ApiTags('fuel')
@Controller('fuel-stations/favorites')
export class FuelFavoriteController {
  constructor(
    private readonly addFavorite: AddFavoriteStationCommand,
    private readonly removeFavorite: RemoveFavoriteStationCommand,
    private readonly listFavorites: ListFavoriteStationsQuery,
    private readonly listDetails: ListFavoriteStationDetailsQuery,
  ) {}

  @Get()
  @ApiOperation({ summary: "Stations favorites de l'utilisateur, de la plus récente à la plus ancienne" })
  @ApiResponse({ status: 200, type: [FavoriteStationResponse] })
  list(@CurrentUser() user: UserId): Promise<FavoriteStationResponse[]> {
    return this.listFavorites.execute(user);
  }

  @Get('details')
  @ApiOperation({
    summary: 'Stations favorites avec leurs prix et la prévision de rupture à 24 h de chaque carburant',
  })
  @ApiResponse({ status: 200, type: FavoriteStationDetailsListResponse })
  details(@CurrentUser() user: UserId): Promise<FavoriteStationDetailsListResponse> {
    return this.listDetails.execute(user);
  }

  @Put(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mettre une station en favori (idempotent)' })
  @ApiParam({ name: 'id', description: 'Identifiant officiel du point de vente' })
  @ApiResponse({ status: 204, description: 'Station favorite' })
  @ApiResponse({ status: 400, description: 'Identifiant mal formé' })
  @ApiResponse({ status: 404, description: 'Station absente du flux officiel' })
  async add(@CurrentUser() user: UserId, @Param('id') id: string): Promise<void> {
    await this.addFavorite.execute(user, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Retirer une station des favorites (idempotent)' })
  @ApiParam({ name: 'id', description: 'Identifiant officiel du point de vente' })
  @ApiResponse({ status: 204, description: 'Favorite retirée' })
  @ApiResponse({ status: 400, description: 'Identifiant mal formé' })
  async remove(@CurrentUser() user: UserId, @Param('id') id: string): Promise<void> {
    await this.removeFavorite.execute(user, id);
  }
}

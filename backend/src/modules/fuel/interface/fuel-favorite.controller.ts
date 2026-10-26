import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AddFavoriteStationCommand } from '../application/commands/add-favorite-station.command';
import { RemoveFavoriteStationCommand } from '../application/commands/remove-favorite-station.command';
import { ListFavoriteStationsQuery } from '../application/queries/list-favorite-stations.query';
import { FavoriteStationResponse } from './dto/fuel-station.response';

/**
 * Stations favorites. `PUT`/`DELETE` sur l'identifiant, idempotents (204
 * dans tous les cas) : c'est un bouton étoile, et l'identifiant officiel est
 * une simple suite de chiffres, sûre dans un chemin — contrairement aux
 * produits, dont l'identifiant encode une URL et voyage dans un corps POST.
 */
@ApiTags('fuel')
@Controller('fuel-stations/favorites')
export class FuelFavoriteController {
  constructor(
    private readonly addFavorite: AddFavoriteStationCommand,
    private readonly removeFavorite: RemoveFavoriteStationCommand,
    private readonly listFavorites: ListFavoriteStationsQuery,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Stations favorites, de la plus récente à la plus ancienne' })
  @ApiResponse({ status: 200, type: [FavoriteStationResponse] })
  list(): Promise<FavoriteStationResponse[]> {
    return this.listFavorites.execute();
  }

  @Put(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mettre une station en favori (idempotent)' })
  @ApiParam({ name: 'id', description: 'Identifiant officiel du point de vente' })
  @ApiResponse({ status: 204, description: 'Station favorite' })
  @ApiResponse({ status: 400, description: 'Identifiant mal formé' })
  @ApiResponse({ status: 404, description: 'Station absente du flux officiel' })
  async add(@Param('id') id: string): Promise<void> {
    await this.addFavorite.execute(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Retirer une station des favorites (idempotent)' })
  @ApiParam({ name: 'id', description: 'Identifiant officiel du point de vente' })
  @ApiResponse({ status: 204, description: 'Favorite retirée' })
  @ApiResponse({ status: 400, description: 'Identifiant mal formé' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.removeFavorite.execute(id);
  }
}

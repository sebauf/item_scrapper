import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserId } from 'src/shared/domain/user-id';
import { CurrentUser } from 'src/shared/interface/http/auth.guard';
import { ProductDetailResponse } from '../../catalog/interface/dto/product.response';
import { AddFavoriteCommand } from '../application/commands/add-favorite.command';
import { RemoveFavoriteCommand } from '../application/commands/remove-favorite.command';
import { IsFavoriteQuery } from '../application/queries/is-favorite.query';
import { ListFavoritesQuery } from '../application/queries/list-favorites.query';
import { AddFavoriteDto } from './dto/add-favorite.dto';
import { FavoriteStatusResponse } from './dto/favorite-status.response';

/**
 * Adaptateur HTTP du contexte favorite.
 *
 * `POST`/`DELETE` sont volontairement idempotents (200/204 dans tous les
 * cas) : c'est le comportement d'un bouton étoile, pas d'un formulaire de
 * création — cf. AddFavoriteCommand / RemoveFavoriteCommand.
 */
@ApiBearerAuth()
@ApiTags('favorites')
@Controller('favorites')
export class FavoriteController {
  constructor(
    private readonly addFavorite: AddFavoriteCommand,
    private readonly removeFavorite: RemoveFavoriteCommand,
    private readonly listFavorites: ListFavoritesQuery,
    private readonly isFavoriteQuery: IsFavoriteQuery,
  ) {}

  @Get()
  @ApiOperation({ summary: "Produits favoris de l'utilisateur, fiche complète avec historique de prix" })
  @ApiResponse({ status: 200, type: [ProductDetailResponse] })
  list(@CurrentUser() user: UserId): Promise<ProductDetailResponse[]> {
    return this.listFavorites.execute(user);
  }

  @Get(':id')
  @ApiOperation({ summary: "Vérifie si un produit est en favori" })
  @ApiParam({ name: 'id', description: 'Identifiant encodé du produit' })
  @ApiResponse({ status: 200, type: FavoriteStatusResponse })
  @ApiResponse({ status: 400, description: 'Identifiant mal formé' })
  async check(
    @CurrentUser() user: UserId,
    @Param('id') id: string,
  ): Promise<FavoriteStatusResponse> {
    return { isFavorite: await this.isFavoriteQuery.execute(user, id) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Mettre un produit en favori (idempotent, suit aussi son prix)' })
  @ApiResponse({ status: 201, description: 'Produit favori' })
  @ApiResponse({ status: 400, description: 'Identifiant mal formé' })
  async add(@CurrentUser() user: UserId, @Body() dto: AddFavoriteDto): Promise<void> {
    await this.addFavorite.execute(user, dto.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Retirer un produit des favoris (idempotent)' })
  @ApiParam({ name: 'id', description: 'Identifiant encodé du produit' })
  @ApiResponse({ status: 204, description: 'Favori retiré' })
  @ApiResponse({ status: 400, description: 'Identifiant mal formé' })
  async remove(@CurrentUser() user: UserId, @Param('id') id: string): Promise<void> {
    await this.removeFavorite.execute(user, id);
  }
}

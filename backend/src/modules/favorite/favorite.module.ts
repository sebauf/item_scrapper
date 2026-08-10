import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { ProductTrackingModule } from '../product-tracking/product-tracking.module';
import { AddFavoriteCommand } from './application/commands/add-favorite.command';
import { RemoveFavoriteCommand } from './application/commands/remove-favorite.command';
import { IsFavoriteQuery } from './application/queries/is-favorite.query';
import { ListFavoritesQuery } from './application/queries/list-favorites.query';
import { FavoriteRepository } from './domain/favorite.repository';
import { MongoFavoriteRepository } from './infrastructure/mongo-favorite.repository';
import { FavoriteController } from './interface/favorite.controller';

/**
 * Câblage du contexte favorite.
 *
 * Dépend de `ProductTrackingModule` (garantir le suivi d'un favori) et de
 * `CatalogModule` (fiche produit complète pour l'affichage) — les deux
 * seules dépendances inter-contextes de la codebase à ce jour, toutes deux
 * volontaires et documentées sur leurs commandes/requêtes respectives.
 */
@Module({
  imports: [ProductTrackingModule, CatalogModule],
  controllers: [FavoriteController],
  providers: [
    AddFavoriteCommand,
    RemoveFavoriteCommand,
    ListFavoritesQuery,
    IsFavoriteQuery,
    { provide: FavoriteRepository, useClass: MongoFavoriteRepository },
  ],
})
export class FavoriteModule {}

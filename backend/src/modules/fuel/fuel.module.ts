import { Module } from '@nestjs/common';
import { AddFavoriteStationCommand } from './application/commands/add-favorite-station.command';
import { RemoveFavoriteStationCommand } from './application/commands/remove-favorite-station.command';
import { FuelStationReadModel } from './application/ports/fuel-station.read-model';
import { ListFavoriteStationsQuery } from './application/queries/list-favorite-stations.query';
import { SearchFuelStationsQuery } from './application/queries/search-fuel-stations.query';
import { FavoriteStationRepository } from './domain/favorite-station.repository';
import { MongoFavoriteStationRepository } from './infrastructure/mongo-favorite-station.repository';
import { MongoFuelStationReadModel } from './infrastructure/mongo-fuel-station.read-model';
import { FuelFavoriteController } from './interface/fuel-favorite.controller';
import { FuelStationController } from './interface/fuel.controller';

/**
 * Contexte Fuel — prix des carburants par station, et stations favorites.
 *
 * `fuel_stations` est écrite par l'import du pipeline
 * (pipeline/src/fuel/import_stations.py) à partir du flux officiel ; le
 * backend ne fait que la lire. Il écrit en revanche `favorite_stations`, que
 * le pipeline relit pour l'alerte de réapprovisionnement. Aucun lien avec
 * Catalog : ni mot-clé, ni scrape, ni score — un autre domaine qui partage
 * seulement la base.
 */
@Module({
  controllers: [FuelFavoriteController, FuelStationController],
  providers: [
    SearchFuelStationsQuery,
    AddFavoriteStationCommand,
    RemoveFavoriteStationCommand,
    ListFavoriteStationsQuery,
    { provide: FuelStationReadModel, useClass: MongoFuelStationReadModel },
    { provide: FavoriteStationRepository, useClass: MongoFavoriteStationRepository },
  ],
})
export class FuelModule {}

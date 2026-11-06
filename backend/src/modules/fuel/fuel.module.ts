import { Module } from '@nestjs/common';
import { AddFavoriteStationCommand } from './application/commands/add-favorite-station.command';
import { RemoveFavoriteStationCommand } from './application/commands/remove-favorite-station.command';
import { FuelStationReadModel } from './application/ports/fuel-station.read-model';
import { RestockForecastReadModel } from './application/ports/restock-forecast.read-model';
import { ShortageForecastReadModel } from './application/ports/shortage-forecast.read-model';
import { ListFavoriteStationDetailsQuery } from './application/queries/list-favorite-station-details.query';
import { ListFavoriteStationsQuery } from './application/queries/list-favorite-stations.query';
import { SearchFuelStationsQuery } from './application/queries/search-fuel-stations.query';
import { FavoriteStationRepository } from './domain/favorite-station.repository';
import { MongoFavoriteStationRepository } from './infrastructure/mongo-favorite-station.repository';
import { MongoFuelStationReadModel } from './infrastructure/mongo-fuel-station.read-model';
import { MongoRestockForecastReadModel } from './infrastructure/mongo-restock-forecast.read-model';
import { MongoShortageForecastReadModel } from './infrastructure/mongo-shortage-forecast.read-model';
import { FuelFavoriteController } from './interface/fuel-favorite.controller';
import { FuelStationController } from './interface/fuel.controller';

/**
 * Contexte Fuel — prix des carburants par station, et stations favorites.
 *
 * `fuel_stations` est écrite par l'import du pipeline
 * (pipeline/src/fuel/import_stations.py) à partir du flux officiel ; le
 * backend ne fait que la lire. Il écrit en revanche `favorite_stations`, que
 * le pipeline relit pour l'alerte de réapprovisionnement (avec le profil de
 * l'utilisateur, cf. ProfileModule). Il lit aussi `fuel_shortage_forecasts`,
 * le risque de rupture à 24 h que le pipeline publie pour les stations
 * favorites (le modèle est en Python), et `fuel_restock_forecasts`, la chance
 * de réapprovisionnement à 24 h de leurs carburants en rupture. Aucun lien avec
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
    ListFavoriteStationDetailsQuery,
    { provide: FuelStationReadModel, useClass: MongoFuelStationReadModel },
    { provide: FavoriteStationRepository, useClass: MongoFavoriteStationRepository },
    { provide: ShortageForecastReadModel, useClass: MongoShortageForecastReadModel },
    { provide: RestockForecastReadModel, useClass: MongoRestockForecastReadModel },
  ],
  // Le contexte Profile compte les stations favorites (les stations que
  // surveille l'alerte de réapprovisionnement).
  exports: [FavoriteStationRepository],
})
export class FuelModule {}

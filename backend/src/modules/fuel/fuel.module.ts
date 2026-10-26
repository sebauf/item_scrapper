import { Module } from '@nestjs/common';
import { FuelStationReadModel } from './application/ports/fuel-station.read-model';
import { SearchFuelStationsQuery } from './application/queries/search-fuel-stations.query';
import { MongoFuelStationReadModel } from './infrastructure/mongo-fuel-station.read-model';
import { FuelStationController } from './interface/fuel.controller';

/**
 * Contexte Fuel — prix des carburants par station, en lecture seule.
 *
 * `fuel_stations` est écrite par l'import du pipeline
 * (pipeline/src/fuel/import_stations.py) à partir du flux officiel. Aucun lien
 * avec Catalog : ni mot-clé, ni scrape, ni score — un autre domaine qui
 * partage seulement la base.
 */
@Module({
  controllers: [FuelStationController],
  providers: [
    SearchFuelStationsQuery,
    { provide: FuelStationReadModel, useClass: MongoFuelStationReadModel },
  ],
})
export class FuelModule {}

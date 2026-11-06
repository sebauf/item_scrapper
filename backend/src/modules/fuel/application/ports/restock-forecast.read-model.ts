import { FuelType } from '../../domain/fuel-type';
import { PublishedRestockForecast } from '../../domain/restock-forecast-policy';

export interface RestockForecastRow extends PublishedRestockForecast {
  stationId: string;
  fuel: FuelType;
}

/**
 * Port de lecture des prévisions de réapprovisionnement.
 * `fuel_restock_forecasts` est écrite par le pipeline après chaque import
 * (pipeline/src/fuel/restock_forecast/forecasts.py), comme les prévisions de
 * rupture : le backend n'en lit que le résultat.
 */
export abstract class RestockForecastReadModel {
  /** Prévisions publiées pour ces stations, sans juger de leur âge. */
  abstract findForStations(stationIds: string[]): Promise<RestockForecastRow[]>;
}

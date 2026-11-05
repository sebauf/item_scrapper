import { FuelType } from '../../domain/fuel-type';
import { PublishedForecast } from '../../domain/shortage-forecast-policy';

export interface ShortageForecastRow extends PublishedForecast {
  stationId: string;
  fuel: FuelType;
}

/**
 * Port de lecture des prévisions de rupture. `fuel_shortage_forecasts` est
 * écrite par le pipeline après chaque import
 * (pipeline/src/fuel/shortage_forecast/forecasts.py) — le modèle est un pickle
 * scikit-learn que seul Python sait exécuter ; le backend n'en lit que le
 * résultat.
 */
export abstract class ShortageForecastReadModel {
  /** Prévisions publiées pour ces stations, sans juger de leur âge. */
  abstract findForStations(stationIds: string[]): Promise<ShortageForecastRow[]>;
}

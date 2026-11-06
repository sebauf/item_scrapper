/**
 * Lecture d'une prévision de réapprovisionnement de carburant.
 *
 * Le pendant de `shortage-forecast-policy` : pour un carburant **en rupture**,
 * le modèle (pipeline/src/fuel/restock_forecast) répond à « cette rupture se
 * termine-t-elle — le carburant revient-il à la pompe — dans les **24 heures** ? »,
 * sous forme d'une probabilité calibrée. Même limite : pas de date de retour,
 * seulement la fin de l'horizon — « retour probable **avant** tel jour, telle
 * heure ».
 *
 * Mêmes règles de publication que la prévision de rupture (toutes les 30 min,
 * écartée au-delà de `FORECAST_MAX_AGE_HOURS`), d'où le partage de l'horizon
 * et de la fraîcheur.
 */
import { forecastHorizonEnd, isForecastFresh } from './shortage-forecast-policy';

/**
 * Retour **probable** : plus d'une chance sur deux. Mesuré sur l'archive réelle
 * (test du 07/10 au 04/11/2026, 39 % des instants de rupture suivis d'un retour
 * dans les 24 h) : 66 % des prévisions au-dessus sont suivies d'un retour, et
 * 62 % des retours sont annoncés. Le modèle est calibré : « 70 % » s'est réalisé
 * 73 % du temps.
 */
export const LIKELY_RESTOCK_THRESHOLD = 0.5;

/**
 * Retour **possible** : en dessous, la rupture a toutes les chances de durer
 * au-delà de 24 h — mieux vaut chercher une autre station. Mesuré : moins de
 * 10 % de retours observés sous ce seuil, et 95 % des retours sont au-dessus.
 */
export const POSSIBLE_RESTOCK_THRESHOLD = 0.2;

export type RestockChanceLevel = 'unlikely' | 'possible' | 'likely';

export interface PublishedRestockForecast {
  /** Probabilité, entre 0 et 1, que la rupture se termine dans l'horizon. */
  probability: number;
  computedAt: Date;
}

export interface RestockOutlook {
  probability: number;
  level: RestockChanceLevel;
  computedAt: Date;
  /** Fin de l'horizon : « retour probable avant… ». */
  horizonEnd: Date;
}

export function restockLevel(probability: number): RestockChanceLevel {
  if (probability >= LIKELY_RESTOCK_THRESHOLD) return 'likely';
  if (probability >= POSSIBLE_RESTOCK_THRESHOLD) return 'possible';
  return 'unlikely';
}

/**
 * Ce qu'on peut dire du retour d'un carburant, ou null :
 *
 * - carburant **disponible** : il n'y a rien à réapprovisionner (c'est la
 *   prévision de rupture qui parle) ;
 * - pas de prévision publiée (pas de modèle, rupture de plus de 7 jours ou sans
 *   date de début — le pipeline s'abstient) ;
 * - prévision trop ancienne ;
 * - prévision **antérieure au début de la rupture en cours** : elle portait sur
 *   une rupture précédente, terminée depuis — ne la recycle pas pour celle-ci.
 */
export function restockOutlook(
  forecast: PublishedRestockForecast | null,
  available: boolean,
  shortageSince: Date | null,
  now: Date,
): RestockOutlook | null {
  if (forecast === null || available) return null;
  if (!isForecastFresh(forecast.computedAt, now)) return null;
  if (shortageSince !== null && forecast.computedAt < shortageSince) return null;
  return {
    probability: forecast.probability,
    level: restockLevel(forecast.probability),
    computedAt: forecast.computedAt,
    horizonEnd: forecastHorizonEnd(forecast.computedAt),
  };
}

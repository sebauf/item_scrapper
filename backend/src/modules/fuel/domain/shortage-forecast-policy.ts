/**
 * Lecture d'une prévision de rupture de carburant.
 *
 * Le modèle (pipeline/src/fuel/shortage_forecast) répond à une seule question :
 * « une rupture de ce carburant commence-t-elle dans cette station dans les
 * **24 heures** ? », sous forme d'une probabilité calibrée. Il ne prédit pas
 * de date : la seule date qu'on peut honnêtement en tirer est la fin de cet
 * horizon — « rupture probable **avant** tel jour, telle heure ». Au-delà de
 * 24 h, le modèle n'a rien appris et ne dit rien.
 *
 * Le pipeline publie ces probabilités toutes les 30 minutes
 * (`fuel_shortage_forecasts`) ; ce module décide de ce qu'on en montre.
 */

/** Horizon du modèle : il prévoit les ruptures qui commencent dans les 24 h. */
export const FORECAST_HORIZON_HOURS = 24;

/**
 * Au-delà, la prévision est écartée. Elle est refaite à chaque import (30 min) :
 * 2 h laissent passer trois imports ratés. Plus vieille, elle décrit une
 * situation qui a pu changer — et son horizon de 24 h a glissé d'autant.
 */
export const FORECAST_MAX_AGE_HOURS = 2;

/**
 * Rupture **probable** : même seuil par défaut que l'alerte de risque
 * (`FUEL_SHORTAGE_RISK_THRESHOLD`). Mesuré sur l'archive réelle, 55 % des
 * prévisions au-dessus sont suivies d'une rupture.
 */
export const LIKELY_SHORTAGE_THRESHOLD = 0.5;

/**
 * Risque **élevé** : environ quatre fois le taux de base mesuré (3,5 % de
 * couples station × carburant entrant en rupture par jour). Pas de quoi
 * alerter, de quoi ne pas attendre le dernier moment pour faire le plein.
 */
export const ELEVATED_SHORTAGE_THRESHOLD = 0.15;

export type ShortageRiskLevel = 'low' | 'elevated' | 'likely';

export interface PublishedForecast {
  /** Probabilité, entre 0 et 1, qu'une rupture commence dans l'horizon. */
  risk: number;
  computedAt: Date;
}

export interface ShortageOutlook {
  risk: number;
  level: ShortageRiskLevel;
  computedAt: Date;
  /** Fin de l'horizon : « rupture probable avant… ». */
  horizonEnd: Date;
}

const HOUR_MS = 3_600_000;

export function riskLevel(risk: number): ShortageRiskLevel {
  if (risk >= LIKELY_SHORTAGE_THRESHOLD) return 'likely';
  if (risk >= ELEVATED_SHORTAGE_THRESHOLD) return 'elevated';
  return 'low';
}

/**
 * Ce qu'on peut dire d'un carburant, ou null si on ne peut rien dire :
 *
 * - pas de prévision publiée (pas de modèle en service, favorite trop récente) ;
 * - prévision trop ancienne (`FORECAST_MAX_AGE_HOURS`) ;
 * - carburant **déjà** en rupture : la question « va-t-il tomber en rupture ? »
 *   n'a plus d'objet, c'est `shortageSince` qui renseigne.
 */
export function shortageOutlook(
  forecast: PublishedForecast | null,
  available: boolean,
  now: Date,
): ShortageOutlook | null {
  if (forecast === null || !available) return null;
  if (now.getTime() - forecast.computedAt.getTime() > FORECAST_MAX_AGE_HOURS * HOUR_MS) return null;
  return {
    risk: forecast.risk,
    level: riskLevel(forecast.risk),
    computedAt: forecast.computedAt,
    horizonEnd: new Date(forecast.computedAt.getTime() + FORECAST_HORIZON_HOURS * HOUR_MS),
  };
}

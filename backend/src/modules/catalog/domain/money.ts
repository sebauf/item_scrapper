/** Montant tel que relevé sur la fiche produit. */
export interface Money {
  amount: number;
  currency: string;
}

/** Prix ramené à une unité de mesure (ex. 3.42 € / L). */
export interface UnitPrice {
  amount: number;
  unit: string;
}

/**
 * Sens d'évolution du prix, calculé par le pipeline Python (régression
 * linéaire sur l'historique du produit).
 */
export type TrendDirection = 'up' | 'down' | 'stable';

export const TREND_DIRECTIONS: readonly TrendDirection[] = ['up', 'down', 'stable'];

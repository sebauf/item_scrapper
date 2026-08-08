/**
 * Politique « bonne affaire ».
 *
 * Le seuil était jusqu'ici une constante d'affichage du frontend
 * (frontend/src/lib/constants.ts). C'est pourtant une décision métier : elle
 * répond à « à partir de quel écart au prix attendu prévient-on l'utilisateur ».
 * Elle vit donc dans le domaine, et le frontend n'en connaîtra plus la valeur —
 * il recevra un booléen déjà calculé.
 *
 * Rappel de ce que le score signifie (calculé par le pipeline Python) :
 *   score = (prix attendu − prix constaté) / prix attendu × 100
 * où le prix attendu est la moyenne glissante sur 30 jours du produit lui-même.
 * Un score de 10 correspond donc à « 10 % sous sa propre moyenne ».
 */
export const DEAL_SCORE_THRESHOLD = 10;

export function isDeal(score: number | null | undefined): boolean {
  return score !== null && score !== undefined && score >= DEAL_SCORE_THRESHOLD;
}

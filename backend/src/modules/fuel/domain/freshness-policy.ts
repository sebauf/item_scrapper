/**
 * Politique de fraîcheur d'un prix de carburant.
 *
 * La date qui compte est celle de la **déclaration par la station**
 * (`updatedAt`), pas celle de notre import : le flux est relu trois fois par
 * jour, mais une station peut ne rien avoir déclaré depuis une semaine.
 *
 * Un prix ancien n'est pas forcément faux. La station doit déclarer chaque
 * changement : un prix daté de quatre jours peut simplement ne pas avoir
 * bougé… ou venir d'une station qui ne déclare plus. Rien dans le flux ne
 * permet de trancher. D'où le choix de **signaler** plutôt que de masquer —
 * l'inverse de la règle des produits Amazon (cf. last-scrape.ts), où c'est
 * notre propre scrape qui fait foi et dont l'absence est donc significative.
 *
 * 72 h : couvre un week-end pendant lequel une station indépendante ne touche
 * pas à ses prix, sans laisser passer une station qui a cessé de déclarer.
 */
export const STALE_AFTER_HOURS = 72;

const HOUR_MS = 3_600_000;

/** Un prix sans date de déclaration est traité comme périmé : rien ne l'atteste. */
export function isStale(updatedAt: Date | null, now: Date): boolean {
  if (updatedAt === null) return true;
  return now.getTime() - updatedAt.getTime() > STALE_AFTER_HOURS * HOUR_MS;
}

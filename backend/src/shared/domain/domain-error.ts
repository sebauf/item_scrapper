/**
 * Erreurs métier. Le domaine ne connaît pas HTTP : il lève des erreurs qui
 * décrivent *ce qui ne va pas*, jamais un code de statut. La traduction en
 * réponse HTTP est faite une seule fois, dans DomainExceptionFilter.
 *
 * Les trois sous-classes correspondent aux trois familles de refus possibles ;
 * toute erreur métier doit hériter de l'une d'elles pour être correctement
 * traduite (sinon elle finira en 500, ce qui est le comportement voulu pour un
 * bug non anticipé).
 */
export abstract class DomainError extends Error {
  /** Identifiant stable, destiné aux clients de l'API (jamais traduit). */
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** L'entrée fournie ne peut pas produire un objet métier valide. → 400 */
export abstract class InvalidInputError extends DomainError {}

/** L'entrée est valide mais l'état actuel du système la refuse. → 409 */
export abstract class ConflictError extends DomainError {}

/** La ressource visée n'existe pas. → 404 */
export abstract class ResourceNotFoundError extends DomainError {}

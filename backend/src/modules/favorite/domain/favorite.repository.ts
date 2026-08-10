export interface FavoriteEntry {
  url: string;
  addedAt: Date;
}

/**
 * Port de persistance des favoris.
 *
 * Pas d'agrégat ici : « favori » est une simple appartenance à un ensemble,
 * sans invariant à protéger au-delà de la validité de l'URL — déjà garantie
 * par `ProductId` côté catalog. Ajouter et retirer sont volontairement
 * idempotents (cf. AddFavoriteCommand / RemoveFavoriteCommand) : un bouton
 * étoile n'a pas de notion d'« ajout en double » qui mériterait un 409.
 */
export abstract class FavoriteRepository {
  abstract add(url: string): Promise<void>;

  abstract remove(url: string): Promise<void>;

  abstract isFavorite(url: string): Promise<boolean>;

  /** Triés du plus récemment favori au plus ancien. */
  abstract list(): Promise<FavoriteEntry[]>;
}

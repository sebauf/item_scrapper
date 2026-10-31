import { UserId } from 'src/shared/domain/user-id';

export interface FavoriteEntry {
  url: string;
  addedAt: Date;
}

/**
 * Port de persistance des favoris — un ensemble **par utilisateur**.
 *
 * Pas d'agrégat ici : « favori » est une simple appartenance à un ensemble,
 * sans invariant à protéger au-delà de la validité de l'URL — déjà garantie
 * par `ProductId` côté catalog. Ajouter et retirer sont volontairement
 * idempotents (cf. AddFavoriteCommand / RemoveFavoriteCommand) : un bouton
 * étoile n'a pas de notion d'« ajout en double » qui mériterait un 409.
 */
export abstract class FavoriteRepository {
  abstract add(owner: UserId, url: string): Promise<void>;

  abstract remove(owner: UserId, url: string): Promise<void>;

  abstract isFavorite(owner: UserId, url: string): Promise<boolean>;

  /** Favoris de `owner`, du plus récemment ajouté au plus ancien. */
  abstract list(owner: UserId): Promise<FavoriteEntry[]>;
}

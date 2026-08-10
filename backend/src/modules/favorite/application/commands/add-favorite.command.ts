import { Injectable } from '@nestjs/common';
import { ProductId } from '../../../catalog/domain/product-id';
import { ProductUrlAlreadyTracked } from '../../../product-tracking/domain/product-tracking.errors';
import { TrackProductUrlCommand } from '../../../product-tracking/application/commands/track-product-url.command';
import { FavoriteRepository } from '../../domain/favorite.repository';

/**
 * Met un produit en favori. Idempotent : refavoriser un produit déjà favori
 * n'est pas une erreur, contrairement à `TrackProductUrlCommand.execute` — un
 * bouton étoile n'a pas de double-soumission qui mériterait un 409.
 *
 * Favoriser garantit aussi la continuité du suivi de prix : on suit
 * désormais explicitement l'URL, indépendamment du mot-clé qui l'a fait
 * découvrir. `ProductUrlAlreadyTracked` est donc un cas normal ici (le
 * produit était déjà suivi, par mot-clé ou individuellement) — seule
 * l'erreur ci-dessous distingue ce cas d'un vrai refus (URL invalide).
 */
@Injectable()
export class AddFavoriteCommand {
  constructor(
    private readonly favorites: FavoriteRepository,
    private readonly trackProductUrl: TrackProductUrlCommand,
  ) {}

  async execute(encodedId: unknown): Promise<void> {
    const productId = ProductId.fromEncoded(encodedId);

    try {
      await this.trackProductUrl.execute(productId.url);
    } catch (error) {
      if (!(error instanceof ProductUrlAlreadyTracked)) throw error;
    }

    await this.favorites.add(productId.url);
  }
}

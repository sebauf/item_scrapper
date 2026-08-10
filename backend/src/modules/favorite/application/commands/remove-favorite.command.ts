import { Injectable } from '@nestjs/common';
import { ProductId } from '../../../catalog/domain/product-id';
import { FavoriteRepository } from '../../domain/favorite.repository';

/**
 * Retire un favori. Idempotent, comme `Keyword.untrack` : retirer un favori
 * déjà absent aboutit à l'état demandé, c'est la sémantique attendue d'un
 * DELETE HTTP. Ne détrack pas l'URL — le suivi de prix continue même sans le
 * signet, jusqu'à un retrait explicite depuis /product-urls.
 */
@Injectable()
export class RemoveFavoriteCommand {
  constructor(private readonly favorites: FavoriteRepository) {}

  async execute(encodedId: unknown): Promise<void> {
    const productId = ProductId.fromEncoded(encodedId);
    await this.favorites.remove(productId.url);
  }
}

import { Injectable } from '@nestjs/common';
import { ProductId } from '../../../catalog/domain/product-id';
import { FavoriteRepository } from '../../domain/favorite.repository';

@Injectable()
export class IsFavoriteQuery {
  constructor(private readonly favorites: FavoriteRepository) {}

  execute(encodedId: unknown): Promise<boolean> {
    const productId = ProductId.fromEncoded(encodedId);
    return this.favorites.isFavorite(productId.url);
  }
}

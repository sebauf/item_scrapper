import { Injectable } from '@nestjs/common';
import { UserId } from 'src/shared/domain/user-id';
import { ProductId } from '../../../catalog/domain/product-id';
import { FavoriteRepository } from '../../domain/favorite.repository';

@Injectable()
export class IsFavoriteQuery {
  constructor(private readonly favorites: FavoriteRepository) {}

  execute(owner: UserId, encodedId: unknown): Promise<boolean> {
    const productId = ProductId.fromEncoded(encodedId);
    return this.favorites.isFavorite(owner, productId.url);
  }
}

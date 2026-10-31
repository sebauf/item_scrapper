import { Injectable } from '@nestjs/common';
import { UserId } from 'src/shared/domain/user-id';
import { ProductId } from '../../../catalog/domain/product-id';
import {
  ProductDetail,
  ProductReadModel,
} from '../../../catalog/application/ports/product.read-model';
import { FavoriteRepository } from '../../domain/favorite.repository';

@Injectable()
export class ListFavoritesQuery {
  constructor(
    private readonly favorites: FavoriteRepository,
    private readonly products: ProductReadModel,
  ) {}

  async execute(owner: UserId): Promise<ProductDetail[]> {
    const entries = await this.favorites.list(owner);
    const details = await Promise.all(
      entries.map((entry) => this.products.findDetail(ProductId.fromUrl(entry.url))),
    );

    // Un favori tout juste ajouté peut n'avoir encore aucun relevé — il
    // réapparaîtra au prochain passage du scrapper plutôt que de casser la page.
    return details.filter((detail): detail is ProductDetail => detail !== null);
  }
}

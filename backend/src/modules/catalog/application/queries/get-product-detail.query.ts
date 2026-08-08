import { Injectable } from '@nestjs/common';
import { ProductNotFound } from '../../domain/catalog.errors';
import { ProductId } from '../../domain/product-id';
import { ProductDetail, ProductReadModel } from '../ports/product.read-model';

/**
 * Fiche produit complète à partir de son identifiant encodé.
 *
 * Deux refus distincts, et c'est volontaire : un identifiant illisible est une
 * erreur d'appel (400, via ProductId), un identifiant valide mais inconnu est
 * une ressource absente (404).
 *
 * Remplace frontend/src/lib/queries.ts:fetchProductDetail.
 */
@Injectable()
export class GetProductDetailQuery {
  constructor(private readonly readModel: ProductReadModel) {}

  async execute(encodedId: string): Promise<ProductDetail> {
    const detail = await this.readModel.findDetail(ProductId.fromEncoded(encodedId));
    if (detail === null) throw new ProductNotFound();
    return detail;
  }
}

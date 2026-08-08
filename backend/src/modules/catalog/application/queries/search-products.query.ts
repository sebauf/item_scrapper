import { Injectable } from '@nestjs/common';
import { ProductQuery, RawProductQuery } from '../../domain/product-query';
import { ProductReadModel, ProductSearchResult } from '../ports/product.read-model';

/**
 * Recherche paginée dans les produits d'un mot-clé.
 *
 * Le use case construit l'objet-valeur `ProductQuery` — c'est lui qui valide et
 * normalise. Le read model reçoit donc toujours des critères sûrs et n'a plus
 * qu'à les traduire en agrégation.
 *
 * Un mot-clé inconnu n'est pas une erreur : le résultat vaut alors 0 partout, et
 * c'est au client de décider quoi en faire (le frontend affiche une 404).
 *
 * Remplace frontend/src/lib/queries.ts:fetchProductsPage.
 */
@Injectable()
export class SearchProductsQuery {
  constructor(private readonly readModel: ProductReadModel) {}

  execute(keyword: string, raw: RawProductQuery): Promise<ProductSearchResult> {
    return this.readModel.search(keyword, ProductQuery.create(raw));
  }
}

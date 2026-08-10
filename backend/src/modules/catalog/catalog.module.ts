import { Module } from '@nestjs/common';
import { DashboardReadModel } from './application/ports/dashboard.read-model';
import { ProductReadModel } from './application/ports/product.read-model';
import { GetDashboardQuery } from './application/queries/get-dashboard.query';
import { GetProductDetailQuery } from './application/queries/get-product-detail.query';
import { SearchProductsQuery } from './application/queries/search-products.query';
import { MongoDashboardReadModel } from './infrastructure/mongo-dashboard.read-model';
import { MongoProductReadModel } from './infrastructure/mongo-product.read-model';
import {
  DashboardController,
  KeywordProductsController,
  ProductController,
} from './interface/catalog.controller';

/**
 * Contexte Catalog — entièrement en lecture.
 *
 * Aucun repository, aucun agrégat : `items_raw`, `price_history` et
 * `deal_scores` sont écrites par le scrapper et le pipeline. Le backend n'y
 * touche jamais, il n'a donc aucun invariant à défendre — seulement des
 * projections à servir vite.
 */
@Module({
  controllers: [DashboardController, KeywordProductsController, ProductController],
  providers: [
    GetDashboardQuery,
    SearchProductsQuery,
    GetProductDetailQuery,
    { provide: DashboardReadModel, useClass: MongoDashboardReadModel },
    { provide: ProductReadModel, useClass: MongoProductReadModel },
  ],
  // ProductReadModel : réutilisé par FavoriteModule pour la fiche complète
  // (historique inclus) des produits favoris.
  exports: [ProductReadModel],
})
export class CatalogModule {}

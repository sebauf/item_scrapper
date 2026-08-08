import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GetDashboardQuery } from '../application/queries/get-dashboard.query';
import { GetProductDetailQuery } from '../application/queries/get-product-detail.query';
import { SearchProductsQuery } from '../application/queries/search-products.query';
import { ProductListQueryDto } from './dto/product-list.query';
import {
  DashboardResponse,
  ProductDetailResponse,
  ProductSearchResponse,
} from './dto/product.response';

@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly getDashboard: GetDashboardQuery) {}

  @Get()
  @ApiOperation({ summary: 'Compteurs globaux et meilleures affaires par mot-clé' })
  @ApiResponse({ status: 200, type: DashboardResponse })
  get(): Promise<DashboardResponse> {
    return this.getDashboard.execute();
  }
}

/**
 * Les produits d'un mot-clé sont exposés sous le mot-clé, parce que c'est bien
 * une sous-ressource : il n'existe pas de liste de produits « en général ».
 * Le contrôleur vit dans le contexte Catalog malgré son chemin — c'est lui qui
 * possède la donnée produit, pas le contexte Keyword.
 */
@ApiTags('products')
@Controller('keywords/:keyword/products')
export class KeywordProductsController {
  constructor(private readonly searchProducts: SearchProductsQuery) {}

  @Get()
  @ApiOperation({ summary: "Produits d'un mot-clé, filtrés, triés et paginés" })
  @ApiParam({ name: 'keyword', example: 'lessive%20liquide' })
  @ApiResponse({ status: 200, type: ProductSearchResponse })
  @ApiResponse({ status: 400, description: 'Paramètre de filtre invalide' })
  search(
    @Param('keyword') keyword: string,
    @Query() query: ProductListQueryDto,
  ): Promise<ProductSearchResponse> {
    return this.searchProducts.execute(keyword, query);
  }
}

@ApiTags('products')
@Controller('products')
export class ProductController {
  constructor(private readonly getProductDetail: GetProductDetailQuery) {}

  @Get(':id')
  @ApiOperation({ summary: 'Fiche produit complète avec historique de prix' })
  @ApiParam({ name: 'id', description: 'Identifiant encodé renvoyé par les listes' })
  @ApiResponse({ status: 200, type: ProductDetailResponse })
  @ApiResponse({ status: 400, description: 'Identifiant mal formé' })
  @ApiResponse({ status: 404, description: 'Produit inconnu' })
  get(@Param('id') id: string): Promise<ProductDetailResponse> {
    return this.getProductDetail.execute(id);
  }
}

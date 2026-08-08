import { ApiProperty } from '@nestjs/swagger';
import { TREND_DIRECTIONS } from '../../domain/money';

/**
 * Contrats de sortie du contexte Catalog.
 *
 * Ce sont des classes uniquement pour que @nestjs/swagger puisse en dériver le
 * schéma OpenAPI — c'est ce schéma que le frontend transformera en types
 * TypeScript. Elles ne contiennent aucun comportement et ne sont jamais
 * instanciées : les read models renvoient déjà des objets de cette forme.
 */
export class MoneyResponse {
  @ApiProperty({ example: 12.99 })
  amount!: number;

  @ApiProperty({ example: 'EUR' })
  currency!: string;
}

export class UnitPriceResponse {
  @ApiProperty({ example: 3.42 })
  amount!: number;

  @ApiProperty({ example: 'L' })
  unit!: string;
}

export class ProductSummaryResponse {
  @ApiProperty({ description: 'Identifiant encodé, à utiliser dans /products/{id}' })
  id!: string;

  @ApiProperty({ example: 'https://www.amazon.fr/dp/B0XXXXXXX' })
  url!: string;

  @ApiProperty({ type: String, nullable: true })
  keyword!: string | null;

  @ApiProperty({ example: 'amazon' })
  shop!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ type: [String] })
  images!: string[];

  @ApiProperty({ type: MoneyResponse, nullable: true })
  price!: MoneyResponse | null;

  @ApiProperty({ type: MoneyResponse, nullable: true })
  crossedOutPrice!: MoneyResponse | null;

  @ApiProperty({ type: UnitPriceResponse, nullable: true })
  unitPrice!: UnitPriceResponse | null;

  @ApiProperty({ type: String, nullable: true, example: 'Livraison lundi 11 août' })
  deliveryDate!: string | null;

  @ApiProperty({ description: 'ISO 8601' })
  scrapedAt!: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Écart au prix attendu en %, null si le produit manque d’historique',
  })
  dealScore!: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Moyenne glissante 30 jours' })
  predictedPrice!: number | null;

  @ApiProperty({ type: String, nullable: true, enum: TREND_DIRECTIONS })
  trendDirection!: string | null;

  @ApiProperty({ description: 'Verdict de la politique « bonne affaire », déjà appliqué' })
  isDeal!: boolean;
}

export class PriceHistoryEntryResponse {
  @ApiProperty({ description: 'ISO 8601' })
  day!: string;

  @ApiProperty({ type: MoneyResponse, nullable: true })
  price!: MoneyResponse | null;

  @ApiProperty({ type: MoneyResponse, nullable: true })
  crossedOutPrice!: MoneyResponse | null;

  @ApiProperty({ type: UnitPriceResponse, nullable: true })
  unitPrice!: UnitPriceResponse | null;

  @ApiProperty({ description: 'ISO 8601' })
  scrapedAt!: string;
}

export class ProductDetailResponse extends ProductSummaryResponse {
  @ApiProperty({ type: [PriceHistoryEntryResponse] })
  history!: PriceHistoryEntryResponse[];

  @ApiProperty({ type: String, nullable: true })
  firstSeen!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastSeen!: string | null;
}

export class ProductSearchResponse {
  @ApiProperty({ type: [ProductSummaryResponse] })
  items!: ProductSummaryResponse[];

  @ApiProperty({ description: 'Produits correspondant aux filtres' })
  total!: number;

  @ApiProperty()
  pageCount!: number;

  @ApiProperty({ description: 'Produits du mot-clé, filtres ignorés' })
  keywordTotal!: number;

  @ApiProperty({ description: 'Bonnes affaires du mot-clé, filtres ignorés' })
  keywordDealCount!: number;
}

export class KeywordDealsResponse {
  @ApiProperty()
  keyword!: string;

  @ApiProperty()
  productCount!: number;

  @ApiProperty()
  totalDeals!: number;

  @ApiProperty({ type: [ProductSummaryResponse], description: 'Les meilleures seulement' })
  deals!: ProductSummaryResponse[];
}

export class DashboardResponse {
  @ApiProperty()
  keywordCount!: number;

  @ApiProperty()
  productCount!: number;

  @ApiProperty()
  dealCount!: number;

  @ApiProperty({ type: String, nullable: true, description: 'Dernière exécution du pipeline' })
  lastUpdate!: string | null;

  @ApiProperty({ type: [KeywordDealsResponse] })
  dealsByKeyword!: KeywordDealsResponse[];
}

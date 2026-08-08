import { Money, TrendDirection, UnitPrice } from '../../domain/money';
import { ProductId } from '../../domain/product-id';
import { ProductQuery } from '../../domain/product-query';

/**
 * Produit tel qu'affiché dans une grille (dashboard ou liste d'un mot-clé).
 *
 * Structure plate, sans comportement : c'est une projection de lecture, pas un
 * agrégat. Les champs de scoring viennent de `deal_scores`, alimenté par le
 * pipeline, et valent `null` tant qu'un produit n'a pas assez d'historique
 * (le pipeline exige 5 relevés minimum).
 */
export interface ProductSummary {
  /** Identifiant encodé, directement utilisable dans une URL de détail. */
  id: string;
  url: string;
  keyword: string | null;
  shop: string;
  title: string;
  images: string[];
  price: Money | null;
  crossedOutPrice: Money | null;
  unitPrice: UnitPrice | null;
  deliveryDate: string | null;
  scrapedAt: string;
  dealScore: number | null;
  predictedPrice: number | null;
  trendDirection: TrendDirection | null;
  /** Verdict de DealPolicy, déjà appliqué : le client n'a plus de seuil à connaître. */
  isDeal: boolean;
}

export interface PriceHistoryEntry {
  day: string;
  price: Money | null;
  crossedOutPrice: Money | null;
  unitPrice: UnitPrice | null;
  scrapedAt: string;
}

/** Fiche produit complète, avec son historique de prix. */
export interface ProductDetail extends ProductSummary {
  history: PriceHistoryEntry[];
  firstSeen: string | null;
  lastSeen: string | null;
}

export interface ProductSearchResult {
  items: ProductSummary[];
  /** Nombre de produits après application des filtres. */
  total: number;
  pageCount: number;
  /** Nombre total de produits du mot-clé, filtres ignorés. */
  keywordTotal: number;
  /** Nombre de bonnes affaires du mot-clé, filtres ignorés. */
  keywordDealCount: number;
}

export abstract class ProductReadModel {
  abstract search(keyword: string, query: ProductQuery): Promise<ProductSearchResult>;

  abstract findDetail(id: ProductId): Promise<ProductDetail | null>;
}

import { ProductSummary } from './product.read-model';

/** Bloc « bonnes affaires » d'un mot-clé sur le tableau de bord. */
export interface KeywordDeals {
  keyword: string;
  productCount: number;
  /** Nombre total de bonnes affaires, dont seules les premières sont dans `deals`. */
  totalDeals: number;
  deals: ProductSummary[];
}

export interface DashboardSnapshot {
  keywordCount: number;
  productCount: number;
  dealCount: number;
  /** Dernière exécution du pipeline, ISO 8601 — null s'il n'a jamais tourné. */
  lastUpdate: string | null;
  dealsByKeyword: KeywordDeals[];
}

export abstract class DashboardReadModel {
  abstract load(): Promise<DashboardSnapshot>;
}

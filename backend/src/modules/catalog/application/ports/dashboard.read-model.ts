import { UserId } from 'src/shared/domain/user-id';
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
  /**
   * Tableau de bord de `owner` : compteurs et blocs portent sur **son**
   * périmètre — ses mots-clés et ses URLs suivies à l'unité —, pas sur tout ce
   * que le scrapper relève pour l'ensemble des utilisateurs.
   */
  abstract load(owner: UserId): Promise<DashboardSnapshot>;
}

import type { Product } from './Product.js';

export interface IProductRepository {
  save(product: Product): Promise<void>;
  findKnownUrlsByKeyword(keyword: string, limit: number): Promise<string[]>;
  /**
   * Marque un produit comme temporairement ou définitivement indisponible :
   * il ne doit plus être scoré tant qu'il n'est pas revu avec succès, mais
   * son historique de prix est conservé (le produit peut revenir en stock).
   */
  markUnavailable(url: string): Promise<void>;
}

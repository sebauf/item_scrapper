import type { Product } from './Product.js';

export interface IProductRepository {
  save(product: Product): Promise<void>;
  findKnownUrlsByKeyword(keyword: string, limit: number): Promise<string[]>;
  deleteByUrl(url: string): Promise<void>;
}

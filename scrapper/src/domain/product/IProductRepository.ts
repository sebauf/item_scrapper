import type { Product } from './Product.js';

export interface IProductRepository {
  save(product: Product): Promise<void>;
}

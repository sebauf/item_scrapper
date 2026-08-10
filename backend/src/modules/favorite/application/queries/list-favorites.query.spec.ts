import { ProductId } from '../../../catalog/domain/product-id';
import {
  ProductDetail,
  ProductReadModel,
  ProductSearchResult,
} from '../../../catalog/application/ports/product.read-model';
import { InMemoryFavoriteRepository } from '../../testing/in-memory-favorite.repository';
import { ListFavoritesQuery } from './list-favorites.query';

const SCRAPED_URL = 'https://www.amazon.fr/dp/B0ABCDEFGH/';
const NOT_YET_SCRAPED_URL = 'https://www.amazon.fr/dp/B0ZZZZZZZZ/';

class StubProductReadModel extends ProductReadModel {
  constructor(private readonly detailsByUrl: Map<string, ProductDetail>) {
    super();
  }

  search(): Promise<ProductSearchResult> {
    throw new Error('not used by ListFavoritesQuery');
  }

  findDetail(id: ProductId): Promise<ProductDetail | null> {
    return Promise.resolve(this.detailsByUrl.get(id.url) ?? null);
  }
}

function detailFor(url: string): ProductDetail {
  return {
    id: ProductId.fromUrl(url).value,
    url,
    keyword: null,
    shop: 'amazon',
    title: 'Produit test',
    images: [],
    price: null,
    crossedOutPrice: null,
    unitPrice: null,
    deliveryDate: null,
    scrapedAt: new Date().toISOString(),
    dealScore: null,
    predictedPrice: null,
    trendDirection: null,
    isDeal: false,
    history: [],
    firstSeen: null,
    lastSeen: null,
  };
}

describe('ListFavoritesQuery', () => {
  it('renvoie la fiche complète de chaque favori scrapé', async () => {
    const favorites = new InMemoryFavoriteRepository({ [SCRAPED_URL]: new Date() });
    const products = new StubProductReadModel(
      new Map([[SCRAPED_URL, detailFor(SCRAPED_URL)]]),
    );

    const result = await new ListFavoritesQuery(favorites, products).execute();

    expect(result).toHaveLength(1);
    expect(result[0].url).toBe(SCRAPED_URL);
  });

  it('ignore un favori pas encore scrapé plutôt que de casser la liste', async () => {
    const favorites = new InMemoryFavoriteRepository({ [NOT_YET_SCRAPED_URL]: new Date() });
    const products = new StubProductReadModel(new Map());

    const result = await new ListFavoritesQuery(favorites, products).execute();

    expect(result).toEqual([]);
  });
});

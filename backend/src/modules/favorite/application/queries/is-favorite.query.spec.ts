import { UserId } from 'src/shared/domain/user-id';
import { ProductId } from '../../../catalog/domain/product-id';
import { InMemoryFavoriteRepository } from '../../testing/in-memory-favorite.repository';
import { IsFavoriteQuery } from './is-favorite.query';

const alice = UserId.create('alice@example.com');
const URL = 'https://www.amazon.fr/dp/B0ABCDEFGH/';
const ID = ProductId.fromUrl(URL).value;

describe('IsFavoriteQuery', () => {
  it('renvoie true pour un produit favori', async () => {
    const favorites = new InMemoryFavoriteRepository({ [URL]: new Date() });
    expect(await new IsFavoriteQuery(favorites).execute(alice, ID)).toBe(true);
  });

  it('renvoie false pour un produit non favori', async () => {
    const favorites = new InMemoryFavoriteRepository();
    expect(await new IsFavoriteQuery(favorites).execute(alice, ID)).toBe(false);
  });

  it('renvoie false pour un produit favori d’un autre utilisateur', async () => {
    const favorites = new InMemoryFavoriteRepository({ [URL]: new Date() }, 'bob@example.com');
    expect(await new IsFavoriteQuery(favorites).execute(alice, ID)).toBe(false);
  });
});

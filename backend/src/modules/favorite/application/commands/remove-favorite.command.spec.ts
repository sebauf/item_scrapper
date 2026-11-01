import { UserId } from 'src/shared/domain/user-id';
import { ProductId } from '../../../catalog/domain/product-id';
import { InMemoryFavoriteRepository } from '../../testing/in-memory-favorite.repository';
import { RemoveFavoriteCommand } from './remove-favorite.command';

const alice = UserId.create('alice@example.com');
const URL = 'https://www.amazon.fr/dp/B0ABCDEFGH/';
const ID = ProductId.fromUrl(URL).value;

describe('RemoveFavoriteCommand', () => {
  it('retire un favori', async () => {
    const favorites = new InMemoryFavoriteRepository({ [URL]: new Date() });

    await new RemoveFavoriteCommand(favorites).execute(alice, ID);

    expect(await favorites.isFavorite(alice, URL)).toBe(false);
  });

  it('reste un succès si le favori est déjà absent', async () => {
    const favorites = new InMemoryFavoriteRepository();

    await expect(new RemoveFavoriteCommand(favorites).execute(alice, ID)).resolves.toBeUndefined();
  });

  it('ne retire pas le même favori chez un autre utilisateur', async () => {
    const favorites = new InMemoryFavoriteRepository({ [URL]: new Date() }, 'bob@example.com');

    await new RemoveFavoriteCommand(favorites).execute(alice, ID);

    expect(await favorites.isFavorite(UserId.create('bob@example.com'), URL)).toBe(true);
  });
});

import { ProductId } from '../../../catalog/domain/product-id';
import { InMemoryFavoriteRepository } from '../../testing/in-memory-favorite.repository';
import { RemoveFavoriteCommand } from './remove-favorite.command';

const URL = 'https://www.amazon.fr/dp/B0ABCDEFGH/';
const ID = ProductId.fromUrl(URL).value;

describe('RemoveFavoriteCommand', () => {
  it('retire un favori', async () => {
    const favorites = new InMemoryFavoriteRepository({ [URL]: new Date() });

    await new RemoveFavoriteCommand(favorites).execute(ID);

    expect(await favorites.isFavorite(URL)).toBe(false);
  });

  it('reste un succès si le favori est déjà absent', async () => {
    const favorites = new InMemoryFavoriteRepository();

    await expect(new RemoveFavoriteCommand(favorites).execute(ID)).resolves.toBeUndefined();
  });
});

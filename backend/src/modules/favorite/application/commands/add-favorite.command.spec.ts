import { ProductId } from '../../../catalog/domain/product-id';
import { TrackProductUrlCommand } from '../../../product-tracking/application/commands/track-product-url.command';
import { InMemoryTrackedUrlRepository } from '../../../product-tracking/testing/in-memory-tracked-url.repository';
import { InMemoryFavoriteRepository } from '../../testing/in-memory-favorite.repository';
import { AddFavoriteCommand } from './add-favorite.command';

const URL = 'https://www.amazon.fr/dp/B0ABCDEFGH/';
const ID = ProductId.fromUrl(URL).value;

describe('AddFavoriteCommand', () => {
  it('favorise un produit et démarre son suivi individuel', async () => {
    const trackedUrls = new InMemoryTrackedUrlRepository();
    const favorites = new InMemoryFavoriteRepository();

    await new AddFavoriteCommand(favorites, new TrackProductUrlCommand(trackedUrls)).execute(ID);

    expect(await favorites.isFavorite(URL)).toBe(true);
    expect(trackedUrls.stateOf(URL)).toBe(true);
  });

  it('est idempotent pour un produit déjà favori', async () => {
    const trackedUrls = new InMemoryTrackedUrlRepository({ [URL]: true });
    const favorites = new InMemoryFavoriteRepository();
    const command = new AddFavoriteCommand(favorites, new TrackProductUrlCommand(trackedUrls));

    await command.execute(ID);
    await expect(command.execute(ID)).resolves.toBeUndefined();

    expect(await favorites.isFavorite(URL)).toBe(true);
  });

  it('favorise un produit déjà suivi par ailleurs (mot-clé) sans lever ProductUrlAlreadyTracked', async () => {
    const trackedUrls = new InMemoryTrackedUrlRepository({ [URL]: true });
    const favorites = new InMemoryFavoriteRepository();

    await expect(
      new AddFavoriteCommand(favorites, new TrackProductUrlCommand(trackedUrls)).execute(ID),
    ).resolves.toBeUndefined();

    expect(await favorites.isFavorite(URL)).toBe(true);
  });
});

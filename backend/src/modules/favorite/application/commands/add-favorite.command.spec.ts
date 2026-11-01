import { UserId } from 'src/shared/domain/user-id';
import { ProductId } from '../../../catalog/domain/product-id';
import { TrackProductUrlCommand } from '../../../product-tracking/application/commands/track-product-url.command';
import { ProductUrlQuotaExceeded } from '../../../product-tracking/domain/product-tracking.errors';
import { TrackedUrlQuota } from '../../../product-tracking/domain/tracked-url-quota';
import { InMemoryTrackedUrlRepository } from '../../../product-tracking/testing/in-memory-tracked-url.repository';
import { InMemoryFavoriteRepository } from '../../testing/in-memory-favorite.repository';
import { AddFavoriteCommand } from './add-favorite.command';

const alice = UserId.create('alice@example.com');
const URL = 'https://www.amazon.fr/dp/B0ABCDEFGH/';
const ID = ProductId.fromUrl(URL).value;

describe('AddFavoriteCommand', () => {
  it('favorise un produit et démarre son suivi individuel', async () => {
    const trackedUrls = new InMemoryTrackedUrlRepository();
    const favorites = new InMemoryFavoriteRepository();

    await new AddFavoriteCommand(favorites, new TrackProductUrlCommand(trackedUrls, new TrackedUrlQuota(0))).execute(alice, ID);

    expect(await favorites.isFavorite(alice, URL)).toBe(true);
    expect(trackedUrls.subscribersOf(URL)).toEqual(['alice@example.com']);
  });

  it('est idempotent pour un produit déjà favori', async () => {
    const trackedUrls = new InMemoryTrackedUrlRepository({ [URL]: ['alice@example.com'] });
    const favorites = new InMemoryFavoriteRepository();
    const command = new AddFavoriteCommand(favorites, new TrackProductUrlCommand(trackedUrls, new TrackedUrlQuota(0)));

    await command.execute(alice, ID);
    await expect(command.execute(alice, ID)).resolves.toBeUndefined();

    expect(await favorites.isFavorite(alice, URL)).toBe(true);
  });

  it('favorise un produit dont l’URL est déjà suivie par l’utilisateur sans lever ProductUrlAlreadyTracked', async () => {
    const trackedUrls = new InMemoryTrackedUrlRepository({ [URL]: ['alice@example.com'] });
    const favorites = new InMemoryFavoriteRepository();

    await expect(
      new AddFavoriteCommand(favorites, new TrackProductUrlCommand(trackedUrls, new TrackedUrlQuota(0))).execute(alice, ID),
    ).resolves.toBeUndefined();

    expect(await favorites.isFavorite(alice, URL)).toBe(true);
  });

  it('ne touche ni aux favoris ni aux suivis des autres utilisateurs', async () => {
    const bob = UserId.create('bob@example.com');
    const trackedUrls = new InMemoryTrackedUrlRepository({ [URL]: ['bob@example.com'] });
    const favorites = new InMemoryFavoriteRepository();

    await new AddFavoriteCommand(favorites, new TrackProductUrlCommand(trackedUrls, new TrackedUrlQuota(0))).execute(alice, ID);

    expect(await favorites.isFavorite(bob, URL)).toBe(false);
    expect(trackedUrls.subscribersOf(URL)).toEqual(['alice@example.com', 'bob@example.com']);
  });

  /**
   * AddFavoriteCommand avale le 409 « déjà suivie », pas celui du quota : un
   * favori au-delà du plafond doit échouer, sinon il serait affiché sans être
   * relevé.
   */
  it('refuse un favori au-delà du quota d’URLs suivies, sans l’enregistrer', async () => {
    const other = 'https://www.amazon.fr/dp/B0OTHER0001/';
    const trackedUrls = new InMemoryTrackedUrlRepository({ [other]: ['alice@example.com'] });
    const favorites = new InMemoryFavoriteRepository();

    await expect(
      new AddFavoriteCommand(
        favorites,
        new TrackProductUrlCommand(trackedUrls, new TrackedUrlQuota(1)),
      ).execute(alice, ID),
    ).rejects.toThrow(ProductUrlQuotaExceeded);
    expect(await favorites.isFavorite(alice, URL)).toBe(false);
  });
});

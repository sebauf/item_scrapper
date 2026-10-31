import { UserId } from 'src/shared/domain/user-id';
import { InvalidProductUrl, ProductUrlAlreadyTracked } from '../../domain/product-tracking.errors';
import { InMemoryTrackedUrlRepository } from '../../testing/in-memory-tracked-url.repository';
import { TrackProductUrlCommand } from './track-product-url.command';

const alice = UserId.create('alice@example.com');
const CANONICAL = 'https://www.amazon.fr/dp/B0ABCDEFGH/';

describe('TrackProductUrlCommand', () => {
  it('crée une URL inconnue et la marque suivie', async () => {
    const repository = new InMemoryTrackedUrlRepository();

    await new TrackProductUrlCommand(repository).execute(alice, 'https://www.amazon.fr/dp/b0abcdefgh');

    expect(repository.subscribersOf(CANONICAL)).toEqual(['alice@example.com']);
  });

  it('canonicalise avant de persister', async () => {
    const repository = new InMemoryTrackedUrlRepository();

    await new TrackProductUrlCommand(repository).execute(alice, 'https://www.amazon.fr/Titre/dp/B0ABCDEFGH/ref=sr_1_1',
    );

    expect(repository.subscribersOf(CANONICAL)).toEqual(['alice@example.com']);
  });

  it('réactive une URL précédemment retirée', async () => {
    const repository = new InMemoryTrackedUrlRepository({ [CANONICAL]: [] });

    await new TrackProductUrlCommand(repository).execute(alice, CANONICAL);

    expect(repository.subscribersOf(CANONICAL)).toEqual(['alice@example.com']);
  });

  it('refuse une URL déjà suivie', async () => {
    const repository = new InMemoryTrackedUrlRepository({ [CANONICAL]: ['alice@example.com'] });

    await expect(new TrackProductUrlCommand(repository).execute(alice, CANONICAL)).rejects.toThrow(
      ProductUrlAlreadyTracked,
    );
  });

  it('rejette une URL invalide sans toucher au dépôt', async () => {
    const repository = new InMemoryTrackedUrlRepository();

    await expect(
      new TrackProductUrlCommand(repository).execute(alice, 'https://www.amazon.de/dp/B0ABCDEFGH'),
    ).rejects.toThrow(InvalidProductUrl);
    expect(repository.subscribersOf(CANONICAL)).toBeUndefined();
  });

  it('accepte qu’un second utilisateur suive une URL déjà suivie par un autre', async () => {
    const repository = new InMemoryTrackedUrlRepository({ [CANONICAL]: ['bob@example.com'] });

    await new TrackProductUrlCommand(repository).execute(alice, CANONICAL);

    expect(repository.subscribersOf(CANONICAL)).toEqual(['alice@example.com', 'bob@example.com']);
  });
});

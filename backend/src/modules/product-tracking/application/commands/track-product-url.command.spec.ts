import { InvalidProductUrl, ProductUrlAlreadyTracked } from '../../domain/product-tracking.errors';
import { InMemoryTrackedUrlRepository } from '../../testing/in-memory-tracked-url.repository';
import { TrackProductUrlCommand } from './track-product-url.command';

const CANONICAL = 'https://www.amazon.fr/dp/B0ABCDEFGH/';

describe('TrackProductUrlCommand', () => {
  it('crée une URL inconnue et la marque suivie', async () => {
    const repository = new InMemoryTrackedUrlRepository();

    await new TrackProductUrlCommand(repository).execute('https://www.amazon.fr/dp/b0abcdefgh');

    expect(repository.stateOf(CANONICAL)).toBe(true);
  });

  it('canonicalise avant de persister', async () => {
    const repository = new InMemoryTrackedUrlRepository();

    await new TrackProductUrlCommand(repository).execute(
      'https://www.amazon.fr/Titre/dp/B0ABCDEFGH/ref=sr_1_1',
    );

    expect(repository.stateOf(CANONICAL)).toBe(true);
  });

  it('réactive une URL précédemment retirée', async () => {
    const repository = new InMemoryTrackedUrlRepository({ [CANONICAL]: false });

    await new TrackProductUrlCommand(repository).execute(CANONICAL);

    expect(repository.stateOf(CANONICAL)).toBe(true);
  });

  it('refuse une URL déjà suivie', async () => {
    const repository = new InMemoryTrackedUrlRepository({ [CANONICAL]: true });

    await expect(new TrackProductUrlCommand(repository).execute(CANONICAL)).rejects.toThrow(
      ProductUrlAlreadyTracked,
    );
  });

  it('rejette une URL invalide sans toucher au dépôt', async () => {
    const repository = new InMemoryTrackedUrlRepository();

    await expect(
      new TrackProductUrlCommand(repository).execute('https://www.amazon.de/dp/B0ABCDEFGH'),
    ).rejects.toThrow(InvalidProductUrl);
    expect(repository.stateOf(CANONICAL)).toBeUndefined();
  });
});

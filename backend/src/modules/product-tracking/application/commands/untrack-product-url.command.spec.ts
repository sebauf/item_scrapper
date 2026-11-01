import { UserId } from 'src/shared/domain/user-id';
import { ProductUrlNotFound } from '../../domain/product-tracking.errors';
import { InMemoryTrackedUrlRepository } from '../../testing/in-memory-tracked-url.repository';
import { UntrackProductUrlCommand } from './untrack-product-url.command';

const alice = UserId.create('alice@example.com');
const CANONICAL = 'https://www.amazon.fr/dp/B0ABCDEFGH/';

describe('UntrackProductUrlCommand', () => {
  it('retire une URL suivie', async () => {
    const repository = new InMemoryTrackedUrlRepository({ [CANONICAL]: ['alice@example.com'] });

    await new UntrackProductUrlCommand(repository).execute(alice, CANONICAL);

    expect(repository.subscribersOf(CANONICAL)).toEqual([]);
  });

  it('reste un succès si l’URL est déjà retirée', async () => {
    const repository = new InMemoryTrackedUrlRepository({ [CANONICAL]: [] });

    await expect(
      new UntrackProductUrlCommand(repository).execute(alice, CANONICAL),
    ).resolves.toBeUndefined();
    expect(repository.subscribersOf(CANONICAL)).toEqual([]);
  });

  it('échoue si l’URL est inconnue', async () => {
    const repository = new InMemoryTrackedUrlRepository();

    await expect(
      new UntrackProductUrlCommand(repository).execute(alice, CANONICAL),
    ).rejects.toThrow(ProductUrlNotFound);
  });

  it('ne retire que l’abonnement de celui qui le demande', async () => {
    const repository = new InMemoryTrackedUrlRepository({
      [CANONICAL]: ['alice@example.com', 'bob@example.com'],
    });

    await new UntrackProductUrlCommand(repository).execute(alice, CANONICAL);

    expect(repository.subscribersOf(CANONICAL)).toEqual(['bob@example.com']);
  });
});

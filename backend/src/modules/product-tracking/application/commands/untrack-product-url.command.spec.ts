import { ProductUrlNotFound } from '../../domain/product-tracking.errors';
import { InMemoryTrackedUrlRepository } from '../../testing/in-memory-tracked-url.repository';
import { UntrackProductUrlCommand } from './untrack-product-url.command';

const CANONICAL = 'https://www.amazon.fr/dp/B0ABCDEFGH/';

describe('UntrackProductUrlCommand', () => {
  it('retire une URL suivie', async () => {
    const repository = new InMemoryTrackedUrlRepository({ [CANONICAL]: true });

    await new UntrackProductUrlCommand(repository).execute(CANONICAL);

    expect(repository.stateOf(CANONICAL)).toBe(false);
  });

  it('reste un succès si l’URL est déjà retirée', async () => {
    const repository = new InMemoryTrackedUrlRepository({ [CANONICAL]: false });

    await expect(
      new UntrackProductUrlCommand(repository).execute(CANONICAL),
    ).resolves.toBeUndefined();
    expect(repository.stateOf(CANONICAL)).toBe(false);
  });

  it('échoue si l’URL est inconnue', async () => {
    const repository = new InMemoryTrackedUrlRepository();

    await expect(
      new UntrackProductUrlCommand(repository).execute(CANONICAL),
    ).rejects.toThrow(ProductUrlNotFound);
  });
});

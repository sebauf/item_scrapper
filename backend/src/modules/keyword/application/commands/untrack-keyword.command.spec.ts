import { UserId } from 'src/shared/domain/user-id';
import { KeywordNotFound } from '../../domain/keyword.errors';
import { InMemoryKeywordRepository } from '../../testing/in-memory-keyword.repository';
import { UntrackKeywordCommand } from './untrack-keyword.command';

const alice = UserId.create('alice@example.com');

describe('UntrackKeywordCommand', () => {
  it('retire un mot-clé suivi', async () => {
    const repository = new InMemoryKeywordRepository({ adoucissant: ['alice@example.com'] });

    await new UntrackKeywordCommand(repository).execute(alice, 'adoucissant');

    expect(repository.subscribersOf('adoucissant')).toEqual([]);
  });

  /**
   * Le cœur du multi-utilisateur : le mot-clé est partagé, l'abonnement ne
   * l'est pas. Alice qui retire « adoucissant » ne doit pas l'enlever à Bob —
   * ni arrêter son scrape.
   */
  it('ne retire que l’abonnement de celui qui le demande', async () => {
    const repository = new InMemoryKeywordRepository({
      adoucissant: ['alice@example.com', 'bob@example.com'],
    });

    await new UntrackKeywordCommand(repository).execute(alice, 'adoucissant');

    expect(repository.subscribersOf('adoucissant')).toEqual(['bob@example.com']);
  });

  it('reste un succès si l’utilisateur ne le suit pas', async () => {
    const repository = new InMemoryKeywordRepository({ adoucissant: ['bob@example.com'] });

    await expect(
      new UntrackKeywordCommand(repository).execute(alice, 'adoucissant'),
    ).resolves.toBeUndefined();
    expect(repository.subscribersOf('adoucissant')).toEqual(['bob@example.com']);
  });

  it('échoue si personne n’a jamais suivi ce mot-clé', async () => {
    const repository = new InMemoryKeywordRepository();

    await expect(new UntrackKeywordCommand(repository).execute(alice, 'inconnu')).rejects.toThrow(
      KeywordNotFound,
    );
    expect(repository.subscribersOf('inconnu')).toBeUndefined();
  });
});

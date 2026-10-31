import { UserId } from 'src/shared/domain/user-id';
import { InvalidKeywordName, KeywordAlreadyTracked } from '../../domain/keyword.errors';
import { InMemoryKeywordRepository } from '../../testing/in-memory-keyword.repository';
import { TrackKeywordCommand } from './track-keyword.command';

const alice = UserId.create('alice@example.com');
const bob = UserId.create('bob@example.com');

describe('TrackKeywordCommand', () => {
  it('crée un mot-clé inconnu, suivi par celui qui le demande', async () => {
    const repository = new InMemoryKeywordRepository();

    await new TrackKeywordCommand(repository).execute(alice, 'lessive liquide');

    expect(repository.subscribersOf('lessive liquide')).toEqual(['alice@example.com']);
  });

  it('normalise avant de persister', async () => {
    const repository = new InMemoryKeywordRepository();

    await new TrackKeywordCommand(repository).execute(alice, '  savon noir  ');

    expect(repository.subscribersOf('savon noir')).toEqual(['alice@example.com']);
    expect(repository.subscribersOf('  savon noir  ')).toBeUndefined();
  });

  it('réactive un mot-clé précédemment retiré', async () => {
    const repository = new InMemoryKeywordRepository({ adoucissant: [] });

    await new TrackKeywordCommand(repository).execute(alice, 'adoucissant');

    expect(repository.subscribersOf('adoucissant')).toEqual(['alice@example.com']);
  });

  it('ajoute un abonné à un mot-clé qu’un autre suit déjà, sans conflit', async () => {
    const repository = new InMemoryKeywordRepository({ adoucissant: ['bob@example.com'] });

    await new TrackKeywordCommand(repository).execute(alice, 'adoucissant');

    expect(repository.subscribersOf('adoucissant')).toEqual([
      'alice@example.com',
      'bob@example.com',
    ]);
  });

  it('refuse un mot-clé déjà suivi par le même utilisateur', async () => {
    const repository = new InMemoryKeywordRepository({ adoucissant: ['alice@example.com'] });

    await expect(
      new TrackKeywordCommand(repository).execute(alice, 'adoucissant'),
    ).rejects.toThrow(KeywordAlreadyTracked);
  });

  it('ne refuse pas Bob parce qu’Alice suit déjà le mot-clé', async () => {
    const repository = new InMemoryKeywordRepository({ adoucissant: ['alice@example.com'] });

    await expect(
      new TrackKeywordCommand(repository).execute(bob, 'adoucissant'),
    ).resolves.toBeUndefined();
  });

  it('rejette un nom invalide sans toucher au dépôt', async () => {
    const repository = new InMemoryKeywordRepository();

    await expect(new TrackKeywordCommand(repository).execute(alice, '   ')).rejects.toThrow(
      InvalidKeywordName,
    );
    expect(repository.subscribersOf('')).toBeUndefined();
  });
});

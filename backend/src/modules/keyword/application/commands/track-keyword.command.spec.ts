import { UserId } from 'src/shared/domain/user-id';
import { InvalidKeywordName, KeywordAlreadyTracked } from '../../domain/keyword.errors';
import { InMemoryKeywordRepository } from '../../testing/in-memory-keyword.repository';
import { KeywordQuota } from '../../domain/keyword-quota';
import { KeywordQuotaExceeded } from '../../domain/keyword.errors';
import { TrackKeywordCommand } from './track-keyword.command';

const UNLIMITED = new KeywordQuota(0);

const alice = UserId.create('alice@example.com');
const bob = UserId.create('bob@example.com');

describe('TrackKeywordCommand', () => {
  it('crée un mot-clé inconnu, suivi par celui qui le demande', async () => {
    const repository = new InMemoryKeywordRepository();

    await new TrackKeywordCommand(repository, UNLIMITED).execute(alice, 'lessive liquide');

    expect(repository.subscribersOf('lessive liquide')).toEqual(['alice@example.com']);
  });

  it('normalise avant de persister', async () => {
    const repository = new InMemoryKeywordRepository();

    await new TrackKeywordCommand(repository, UNLIMITED).execute(alice, '  savon noir  ');

    expect(repository.subscribersOf('savon noir')).toEqual(['alice@example.com']);
    expect(repository.subscribersOf('  savon noir  ')).toBeUndefined();
  });

  it('réactive un mot-clé précédemment retiré', async () => {
    const repository = new InMemoryKeywordRepository({ adoucissant: [] });

    await new TrackKeywordCommand(repository, UNLIMITED).execute(alice, 'adoucissant');

    expect(repository.subscribersOf('adoucissant')).toEqual(['alice@example.com']);
  });

  it('ajoute un abonné à un mot-clé qu’un autre suit déjà, sans conflit', async () => {
    const repository = new InMemoryKeywordRepository({ adoucissant: ['bob@example.com'] });

    await new TrackKeywordCommand(repository, UNLIMITED).execute(alice, 'adoucissant');

    expect(repository.subscribersOf('adoucissant')).toEqual([
      'alice@example.com',
      'bob@example.com',
    ]);
  });

  it('refuse un mot-clé déjà suivi par le même utilisateur', async () => {
    const repository = new InMemoryKeywordRepository({ adoucissant: ['alice@example.com'] });

    await expect(
      new TrackKeywordCommand(repository, UNLIMITED).execute(alice, 'adoucissant'),
    ).rejects.toThrow(KeywordAlreadyTracked);
  });

  it('ne refuse pas Bob parce qu’Alice suit déjà le mot-clé', async () => {
    const repository = new InMemoryKeywordRepository({ adoucissant: ['alice@example.com'] });

    await expect(
      new TrackKeywordCommand(repository, UNLIMITED).execute(bob, 'adoucissant'),
    ).resolves.toBeUndefined();
  });

  it('rejette un nom invalide sans toucher au dépôt', async () => {
    const repository = new InMemoryKeywordRepository();

    await expect(new TrackKeywordCommand(repository, UNLIMITED).execute(alice, '   ')).rejects.toThrow(
      InvalidKeywordName,
    );
    expect(repository.subscribersOf('')).toBeUndefined();
  });

  describe('quota', () => {
    it('refuse un mot-clé de plus au plafond, sans rien écrire', async () => {
      const repository = new InMemoryKeywordRepository({ a: [alice.value], b: [alice.value] });

      await expect(
        new TrackKeywordCommand(repository, new KeywordQuota(2)).execute(alice, 'c'),
      ).rejects.toThrow(KeywordQuotaExceeded);
      expect(repository.subscribersOf('c')).toBeUndefined();
    });

    it('ne compte que les abonnements de l’utilisateur', async () => {
      const repository = new InMemoryKeywordRepository({ a: [bob.value], b: [bob.value] });

      await new TrackKeywordCommand(repository, new KeywordQuota(2)).execute(alice, 'c');

      expect(repository.subscribersOf('c')).toEqual([alice.value]);
    });

    it('signale « déjà suivi » plutôt que le quota pour un mot-clé déjà suivi', async () => {
      const repository = new InMemoryKeywordRepository({ a: [alice.value] });

      await expect(
        new TrackKeywordCommand(repository, new KeywordQuota(1)).execute(alice, 'a'),
      ).rejects.toThrow(KeywordAlreadyTracked);
    });

    it('autorise de nouveau un ajout après un retrait', async () => {
      const repository = new InMemoryKeywordRepository({ a: [alice.value], b: [] });

      await new TrackKeywordCommand(repository, new KeywordQuota(2)).execute(alice, 'b');

      expect(repository.subscribersOf('b')).toEqual([alice.value]);
    });
  });
});

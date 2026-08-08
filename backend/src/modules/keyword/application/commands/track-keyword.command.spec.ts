import { InvalidKeywordName, KeywordAlreadyTracked } from '../../domain/keyword.errors';
import { InMemoryKeywordRepository } from '../../testing/in-memory-keyword.repository';
import { TrackKeywordCommand } from './track-keyword.command';

describe('TrackKeywordCommand', () => {
  it('crée un mot-clé inconnu et le marque suivi', async () => {
    const repository = new InMemoryKeywordRepository();

    await new TrackKeywordCommand(repository).execute('lessive liquide');

    expect(repository.stateOf('lessive liquide')).toBe(true);
  });

  it('normalise avant de persister', async () => {
    const repository = new InMemoryKeywordRepository();

    await new TrackKeywordCommand(repository).execute('  savon noir  ');

    expect(repository.stateOf('savon noir')).toBe(true);
    expect(repository.stateOf('  savon noir  ')).toBeUndefined();
  });

  it('réactive un mot-clé précédemment retiré', async () => {
    const repository = new InMemoryKeywordRepository({ adoucissant: false });

    await new TrackKeywordCommand(repository).execute('adoucissant');

    expect(repository.stateOf('adoucissant')).toBe(true);
  });

  it('refuse un mot-clé déjà suivi', async () => {
    const repository = new InMemoryKeywordRepository({ adoucissant: true });

    await expect(new TrackKeywordCommand(repository).execute('adoucissant')).rejects.toThrow(
      KeywordAlreadyTracked,
    );
  });

  it('rejette un nom invalide sans toucher au dépôt', async () => {
    const repository = new InMemoryKeywordRepository();

    await expect(new TrackKeywordCommand(repository).execute('   ')).rejects.toThrow(
      InvalidKeywordName,
    );
    expect(repository.stateOf('')).toBeUndefined();
  });
});

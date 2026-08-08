import { KeywordNotFound } from '../../domain/keyword.errors';
import { InMemoryKeywordRepository } from '../../testing/in-memory-keyword.repository';
import { UntrackKeywordCommand } from './untrack-keyword.command';

describe('UntrackKeywordCommand', () => {
  it('retire un mot-clé suivi', async () => {
    const repository = new InMemoryKeywordRepository({ adoucissant: true });

    await new UntrackKeywordCommand(repository).execute('adoucissant');

    expect(repository.stateOf('adoucissant')).toBe(false);
  });

  it('reste un succès si le mot-clé est déjà retiré', async () => {
    const repository = new InMemoryKeywordRepository({ adoucissant: false });

    await expect(
      new UntrackKeywordCommand(repository).execute('adoucissant'),
    ).resolves.toBeUndefined();
    expect(repository.stateOf('adoucissant')).toBe(false);
  });

  it('échoue si le mot-clé est inconnu', async () => {
    const repository = new InMemoryKeywordRepository();

    await expect(new UntrackKeywordCommand(repository).execute('inconnu')).rejects.toThrow(
      KeywordNotFound,
    );
  });
});

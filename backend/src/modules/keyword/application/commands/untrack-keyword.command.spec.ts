import { KeywordNotFound } from '../../domain/keyword.errors';
import { InMemoryKeywordRepository } from '../../testing/in-memory-keyword.repository';
import { InMemoryScrapedKeywords } from '../../testing/in-memory-scraped-keywords';
import { UntrackKeywordCommand } from './untrack-keyword.command';

function command(
  repository: InMemoryKeywordRepository,
  scraped: string[] = [],
): UntrackKeywordCommand {
  return new UntrackKeywordCommand(repository, new InMemoryScrapedKeywords(scraped));
}

describe('UntrackKeywordCommand', () => {
  it('retire un mot-clé suivi', async () => {
    const repository = new InMemoryKeywordRepository({ adoucissant: true });

    await command(repository).execute('adoucissant');

    expect(repository.stateOf('adoucissant')).toBe(false);
  });

  it('reste un succès si le mot-clé est déjà retiré', async () => {
    const repository = new InMemoryKeywordRepository({ adoucissant: false });

    await expect(command(repository).execute('adoucissant')).resolves.toBeUndefined();
    expect(repository.stateOf('adoucissant')).toBe(false);
  });

  it('échoue si le mot-clé est inconnu', async () => {
    const repository = new InMemoryKeywordRepository();

    await expect(command(repository).execute('inconnu')).rejects.toThrow(KeywordNotFound);
  });

  /**
   * Le cas qui manquait : la page liste ce mot-clé parce qu'`items_raw` en a des
   * relevés, mais aucun document ne le décrit. Sans écriture, le retrait était
   * un 404 que le frontend traitait en succès, et la ligne revenait.
   */
  it('retire un mot-clé connu de ses seuls relevés en écrivant son document', async () => {
    const repository = new InMemoryKeywordRepository();

    await command(repository, ['batterie canape electrique']).execute('batterie canape electrique');

    expect(repository.stateOf('batterie canape electrique')).toBe(false);
  });

  it("n'écrit rien pour un mot-clé que même les relevés ne connaissent pas", async () => {
    const repository = new InMemoryKeywordRepository();

    await expect(command(repository, ['adoucissant']).execute('inconnu')).rejects.toThrow(
      KeywordNotFound,
    );
    expect(repository.stateOf('inconnu')).toBeUndefined();
  });
});

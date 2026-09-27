import { Db } from 'mongodb';
import {
  KeywordDocument,
  MongoKeywordSummaryReadModel,
  RawKeywordStat,
  mergeKeywordSummaries,
} from './mongo-keyword-summary.read-model';

/**
 * L'écran « mots-clés » n'est pas la collection `keywords` : c'est une fusion
 * de cette collection avec ce que le scrapper a laissé dans `items_raw`. Toute
 * la difficulté tient dans ce que la fusion fait des mots-clés qu'elle ne
 * retrouve que d'un seul côté.
 */
describe('mergeKeywordSummaries', () => {
  const stat = (keyword: string, overrides: Partial<RawKeywordStat> = {}): RawKeywordStat => ({
    keyword,
    productCount: 12,
    lastScrape: new Date('2026-08-08T06:00:00.000Z'),
    ...overrides,
  });

  it('affiche un mot-clé suivi avec ses statistiques', () => {
    const summaries = mergeKeywordSummaries([{ keyword: 'lessive', enabled: true }], [stat('lessive')]);

    expect(summaries).toEqual([
      { keyword: 'lessive', productCount: 12, lastScrape: '2026-08-08T06:00:00.000Z' },
    ]);
  });

  it('affiche un mot-clé suivi qui n’a encore rien remonté', () => {
    const summaries = mergeKeywordSummaries([{ keyword: 'lessive', enabled: true }], []);

    expect(summaries).toEqual([{ keyword: 'lessive', productCount: 0, lastScrape: null }]);
  });

  it('rattrape un mot-clé scrapé avant l’existence de la collection keywords', () => {
    const summaries = mergeKeywordSummaries([], [stat('adoucissant')]);

    expect(summaries.map((s) => s.keyword)).toEqual(['adoucissant']);
  });

  /**
   * Le défaut corrigé. Retirer un mot-clé pose `enabled: false` sans supprimer
   * la ligne, et ses relevés restent dans `items_raw` une quinzaine de jours,
   * jusqu'à la purge. Tant que la fusion ne regardait que les documents suivis,
   * le rattrapage ci-dessus le reprenait pour un mot-clé jamais déclaré et le
   * remettait dans la liste — retiré du scrape, mais toujours affiché.
   */
  it('ne ressuscite pas un mot-clé retiré dont les relevés survivent', () => {
    const summaries = mergeKeywordSummaries(
      [{ keyword: 'retire', enabled: false }],
      [stat('retire')],
    );

    expect(summaries).toEqual([]);
  });

  it('ne ressuscite pas davantage un document historique sans champ enabled', () => {
    // Le scrapper ne relève que `enabled: true` : afficher ce mot-clé
    // promettrait un scrape qui n'aura pas lieu.
    const summaries = mergeKeywordSummaries([{ keyword: 'vieux' }], [stat('vieux')]);

    expect(summaries).toEqual([]);
  });

  it('n’affecte pas les mots-clés voisins', () => {
    const summaries = mergeKeywordSummaries(
      [
        { keyword: 'lessive', enabled: true },
        { keyword: 'retire', enabled: false },
      ],
      [stat('lessive'), stat('retire'), stat('adoucissant')],
    );

    expect(summaries.map((s) => s.keyword)).toEqual(['adoucissant', 'lessive']);
  });

  it('trie selon l’ordre alphabétique français, accents compris', () => {
    const summaries = mergeKeywordSummaries(
      [
        { keyword: 'zeste', enabled: true },
        { keyword: 'éponge', enabled: true },
        { keyword: 'aspirateur', enabled: true },
      ],
      [],
    );

    expect(summaries.map((s) => s.keyword)).toEqual(['aspirateur', 'éponge', 'zeste']);
  });
});

/**
 * La règle ci-dessus ne tient que si le read model lui passe *tous* les
 * documents. Refiltrer la requête sur `enabled: true` ramènerait le bug sans
 * qu'aucun des tests précédents ne bronche : celui-ci garde la requête.
 */
describe('MongoKeywordSummaryReadModel', () => {
  function stubDb(keywordDocs: KeywordDocument[], capture: { filter?: unknown }): Db {
    return {
      collection: (name: string) => {
        if (name === 'keywords') {
          return {
            find: (filter: unknown) => {
              capture.filter = filter;
              return { toArray: () => Promise.resolve(keywordDocs) };
            },
          };
        }
        return {
          findOne: () => Promise.resolve({ day: new Date('2026-08-08T00:00:00.000Z') }),
          aggregate: () => ({
            toArray: () =>
              Promise.resolve([
                {
                  fresh: [{ _id: 'retire', productCount: 3 }],
                  seen: [{ _id: 'retire', lastScrape: new Date('2026-08-08T06:00:00.000Z') }],
                },
              ]),
          }),
        };
      },
    } as unknown as Db;
  }

  it('interroge `keywords` sans filtre, pour connaître aussi les mots-clés retirés', async () => {
    const capture: { filter?: unknown } = {};
    const readModel = new MongoKeywordSummaryReadModel(
      stubDb([{ keyword: 'retire', enabled: false }], capture),
    );

    await readModel.listTracked();

    expect(capture.filter).toEqual({});
  });

  it('ne renvoie pas un mot-clé retiré qui a encore des produits frais', async () => {
    const readModel = new MongoKeywordSummaryReadModel(
      stubDb([{ keyword: 'retire', enabled: false }], {}),
    );

    await expect(readModel.listTracked()).resolves.toEqual([]);
  });
});

import { Db, Document } from 'mongodb';
import { UserId } from 'src/shared/domain/user-id';
import {
  MongoKeywordSummaryReadModel,
  RawKeywordStat,
  mergeKeywordSummaries,
} from './mongo-keyword-summary.read-model';

const alice = UserId.create('alice@example.com');

describe('mergeKeywordSummaries', () => {
  const stat = (keyword: string, overrides: Partial<RawKeywordStat> = {}): RawKeywordStat => ({
    keyword,
    productCount: 12,
    lastScrape: new Date('2026-08-08T06:00:00.000Z'),
    ...overrides,
  });

  it('affiche un mot-clé suivi avec ses statistiques', () => {
    expect(mergeKeywordSummaries(['lessive'], [stat('lessive')])).toEqual([
      { keyword: 'lessive', productCount: 12, lastScrape: '2026-08-08T06:00:00.000Z' },
    ]);
  });

  it('affiche un mot-clé suivi qui n’a encore rien remonté', () => {
    expect(mergeKeywordSummaries(['lessive'], [])).toEqual([
      { keyword: 'lessive', productCount: 0, lastScrape: null },
    ]);
  });

  it('n’affiche pas un mot-clé que l’utilisateur ne suit pas, même s’il a des relevés', () => {
    // Les relevés d'items_raw sont partagés : ceux des mots-clés des autres
    // utilisateurs ne doivent pas apparaître dans la liste.
    expect(mergeKeywordSummaries(['lessive'], [stat('lessive'), stat('autre')]).map((s) => s.keyword)).toEqual([
      'lessive',
    ]);
  });

  it('trie selon l’ordre alphabétique français, accents compris', () => {
    const summaries = mergeKeywordSummaries(['zeste', 'éponge', 'aspirateur'], []);

    expect(summaries.map((s) => s.keyword)).toEqual(['aspirateur', 'éponge', 'zeste']);
  });
});

describe('MongoKeywordSummaryReadModel', () => {
  function stubDb(
    keywordDocs: { keyword: string }[],
    capture: { filter?: unknown; pipeline?: Document[]; aggregated?: boolean },
  ): Db {
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
          aggregate: (pipeline: Document[]) => {
            capture.pipeline = pipeline;
            capture.aggregated = true;
            return {
              toArray: () =>
                Promise.resolve([
                  {
                    fresh: [{ _id: 'lessive', productCount: 3 }],
                    seen: [{ _id: 'lessive', lastScrape: new Date('2026-08-08T06:00:00.000Z') }],
                  },
                ]),
            };
          },
        };
      },
    } as unknown as Db;
  }

  it('ne lit que les mots-clés dont l’utilisateur est abonné', async () => {
    const capture: { filter?: unknown } = {};
    const readModel = new MongoKeywordSummaryReadModel(stubDb([], capture));

    await readModel.listTrackedNames(alice);

    expect(capture.filter).toEqual({ subscribers: 'alice@example.com' });
  });

  it('restreint les statistiques aux mots-clés suivis', async () => {
    const capture: { pipeline?: Document[] } = {};
    const readModel = new MongoKeywordSummaryReadModel(stubDb([{ keyword: 'lessive' }], capture));

    await expect(readModel.listTracked(alice)).resolves.toEqual([
      { keyword: 'lessive', productCount: 3, lastScrape: '2026-08-08T06:00:00.000Z' },
    ]);
    expect(capture.pipeline?.[0]).toEqual({
      $match: { title: { $ne: '' }, price: { $ne: null }, keyword: { $in: ['lessive'] } },
    });
  });

  it('n’interroge pas items_raw pour un utilisateur sans mot-clé', async () => {
    const capture: { aggregated?: boolean } = {};
    const readModel = new MongoKeywordSummaryReadModel(stubDb([], capture));

    await expect(readModel.listTracked(alice)).resolves.toEqual([]);
    expect(capture.aggregated).toBeUndefined();
  });
});

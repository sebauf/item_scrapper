import { Db } from 'mongodb';
import { KeywordName } from '../domain/keyword-name';
import { MongoScrapedKeywords } from './mongo-scraped-keywords';

describe('MongoScrapedKeywords', () => {
  function stubDb(found: object | null, capture: { filter?: unknown; collection?: string }): Db {
    return {
      collection: (name: string) => {
        capture.collection = name;
        return {
          findOne: (filter: unknown) => {
            capture.filter = filter;
            return Promise.resolve(found);
          },
        };
      },
    } as unknown as Db;
  }

  it('reconnaît un mot-clé qui a au moins un relevé exploitable', async () => {
    const scraped = new MongoScrapedKeywords(stubDb({ _id: 'x' }, {}));

    await expect(scraped.has(KeywordName.create('adoucissant'))).resolves.toBe(true);
  });

  it('ne reconnaît pas un mot-clé sans relevé', async () => {
    const scraped = new MongoScrapedKeywords(stubDb(null, {}));

    await expect(scraped.has(KeywordName.create('inconnu'))).resolves.toBe(false);
  });

  /**
   * Le prédicat doit être celui de la lecture, au mot-clé cherché près : s'il
   * était plus strict, on refuserait de retirer un mot-clé pourtant affiché.
   * Et `keyword` doit bien avoir remplacé le `$ne: null` du prédicat partagé,
   * sinon la requête répondrait « oui » pour n'importe quel nom.
   */
  it('cherche dans items_raw avec le prédicat de la lecture, ciblé sur le mot-clé', async () => {
    const capture: { filter?: unknown; collection?: string } = {};
    const scraped = new MongoScrapedKeywords(stubDb(null, capture));

    await scraped.has(KeywordName.create('adoucissant'));

    expect(capture.collection).toBe('items_raw');
    expect(capture.filter).toEqual({
      keyword: 'adoucissant',
      title: { $ne: '' },
      price: { $ne: null },
    });
  });
});

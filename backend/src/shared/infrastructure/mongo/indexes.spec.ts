import { Db, MongoServerError } from 'mongodb';
import { ensureIndexes, REQUIRED_INDEXES } from './indexes';

describe('ensureIndexes', () => {
  function stubDb(indexExists: () => Promise<boolean>, created: string[]): Db {
    return {
      collection: (name: string) => ({
        indexExists,
        createIndex: (_keys: unknown, options: { name: string }) => {
          created.push(`${name}.${options.name}`);
          return Promise.resolve(options.name);
        },
      }),
    } as unknown as Db;
  }

  it('crée les index d’une collection qui n’existe pas encore, au lieu d’empêcher le démarrage', async () => {
    const created: string[] = [];
    const missing = () =>
      Promise.reject(new MongoServerError({ message: 'ns does not exist', code: 26 }));

    await expect(ensureIndexes(stubDb(missing, created))).resolves.toHaveLength(
      REQUIRED_INDEXES.length,
    );
    expect(created).toContain('favorites.userId_url');
  });

  it('ne recrée pas un index existant', async () => {
    const created: string[] = [];

    await ensureIndexes(stubDb(() => Promise.resolve(true), created));

    expect(created).toEqual([]);
  });

  it('laisse remonter les autres erreurs Mongo', async () => {
    const failing = () => Promise.reject(new MongoServerError({ message: 'auth', code: 13 }));

    await expect(ensureIndexes(stubDb(failing, []))).rejects.toThrow('auth');
  });
});

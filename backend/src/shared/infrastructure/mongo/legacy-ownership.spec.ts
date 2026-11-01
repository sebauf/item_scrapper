import { Db, Document } from 'mongodb';
import { UserId } from 'src/shared/domain/user-id';
import { claimLegacyData } from './legacy-ownership';

/**
 * Le rattachement tourne à chaque démarrage : ce qui compte, c'est qu'il ne
 * touche **que** les documents sans propriétaire (sinon un redémarrage
 * réattribuerait à l'administrateur les favoris de tout le monde), et qu'il
 * garde le scrapper cohérent (`enabled` recalculé).
 */
describe('claimLegacyData', () => {
  const owner = UserId.create('moi@gmail.com');

  function stubDb(calls: Record<string, { filter: Document; update: unknown }>): Db {
    return {
      collection: (name: string) => ({
        updateMany: (filter: Document, update: unknown) => {
          calls[name] = { filter, update };
          return Promise.resolve({ modifiedCount: 1 });
        },
      }),
    } as unknown as Db;
  }

  it('ne vise que les documents sans propriétaire', async () => {
    const calls: Record<string, { filter: Document; update: unknown }> = {};

    await claimLegacyData(stubDb(calls), owner);

    expect(calls.keywords.filter).toEqual({ subscribers: { $exists: false } });
    expect(calls.tracked_urls.filter).toEqual({ subscribers: { $exists: false } });
    expect(calls.favorites.filter).toEqual({ userId: { $exists: false } });
    expect(calls.favorite_stations.filter).toEqual({ userId: { $exists: false } });
  });

  it('abonne le propriétaire aux seuls mots-clés que le scrapper relevait, puis recalcule enabled', async () => {
    const calls: Record<string, { filter: Document; update: unknown }> = {};

    await claimLegacyData(stubDb(calls), owner);

    expect(calls.keywords.update).toEqual([
      { $set: { subscribers: { $cond: [{ $eq: ['$enabled', true] }, ['moi@gmail.com'], []] } } },
      { $set: { enabled: { $gt: [{ $size: '$subscribers' }, 0] } } },
    ]);
  });

  it('recopie l’identifiant historique de la station dans stationId', async () => {
    const calls: Record<string, { filter: Document; update: unknown }> = {};

    await claimLegacyData(stubDb(calls), owner);

    expect(calls.favorite_stations.update).toEqual([
      { $set: { userId: 'moi@gmail.com', stationId: '$_id' } },
    ]);
  });

  it('rapporte le nombre de documents rattachés par collection', async () => {
    await expect(claimLegacyData(stubDb({}), owner)).resolves.toEqual({
      keywords: 1,
      trackedUrls: 1,
      favorites: 1,
      favoriteStations: 1,
    });
  });
});

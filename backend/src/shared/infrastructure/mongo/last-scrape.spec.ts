import { Db } from 'mongodb';
import { findLastScrapeDay, onlyLastScrape } from './last-scrape';

/**
 * Deux comportements à figer, parce que c'est d'eux que dépend la disparition
 * des produits indisponibles de tous les écrans : la lecture du jour de
 * référence (le plus récent, pas le premier trouvé) et le cas « base vide »,
 * qui ne doit pas se transformer en filtre impossible.
 */
describe('findLastScrapeDay', () => {
  const day = new Date('2026-09-27T00:00:00.000Z');

  function dbReturning(doc: { day?: Date } | null) {
    const findOne = jest.fn().mockResolvedValue(doc);
    return {
      db: { collection: () => ({ findOne }) } as unknown as Db,
      findOne,
    };
  }

  it('lit le jour le plus récent de items_raw', async () => {
    const { db, findOne } = dbReturning({ day });

    await expect(findLastScrapeDay(db)).resolves.toBe(day);
    expect(findOne).toHaveBeenCalledWith({}, { sort: { day: -1 }, projection: { day: 1 } });
  });

  it('renvoie null sur une base sans relevé', async () => {
    const { db } = dbReturning(null);

    await expect(findLastScrapeDay(db)).resolves.toBeNull();
  });

  it('renvoie null quand le document trouvé n’a pas de jour', async () => {
    // Document écrit avant l'introduction de `day` : mieux vaut ne rien
    // filtrer que filtrer sur `undefined`, que Mongo lit comme `null`.
    const { db } = dbReturning({});

    await expect(findLastScrapeDay(db)).resolves.toBeNull();
  });
});

describe('onlyLastScrape', () => {
  const day = new Date('2026-09-27T00:00:00.000Z');

  it('ajoute le jour au filtre de l’appelant', () => {
    expect(onlyLastScrape({ keyword: 'lessive' }, day)).toEqual({
      day,
      keyword: 'lessive',
    });
  });

  it('laisse le filtre intact quand aucun jour n’est connu', () => {
    expect(onlyLastScrape({ keyword: 'lessive' }, null)).toEqual({
      keyword: 'lessive',
    });
  });

  it('impose sa contrainte de jour à celle de l’appelant', () => {
    // Personne ne filtre déjà sur `day` aujourd'hui, mais si ça arrivait, la
    // fraîcheur ne doit pas être le réglage qui saute silencieusement.
    expect(onlyLastScrape({ day: new Date('2020-01-01T00:00:00.000Z') }, day)).toEqual({ day });
  });
});

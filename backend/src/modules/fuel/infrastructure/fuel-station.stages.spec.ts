import { Document } from 'mongodb';
import { MAX_STATIONS, StationSearch } from '../domain/station-search';
import { sortBrands, toStationRow } from './mongo-fuel-station.read-model';
import { nearBrandsPipeline, nearStationsPipeline } from './fuel-station.stages';

/**
 * Comme pour aggregation-stages.spec.ts côté Catalog : on fige la *forme* du
 * pipeline, son exécution demanderait un vrai serveur. Les points vérifiés
 * sont ceux qu'une erreur rendrait silencieux — une carte vide ou fausse,
 * jamais une exception.
 */
describe('nearStationsPipeline', () => {
  const lyon = { lat: '45.7578', lng: '4.8320' };

  it('commence par $geoNear, longitude d’abord, rayon en mètres', () => {
    const [first] = nearStationsPipeline(StationSearch.create({ ...lyon, radiusKm: '5' }));

    expect(first.$geoNear).toMatchObject({
      near: { type: 'Point', coordinates: [4.832, 45.7578] },
      key: 'location',
      maxDistance: 5000,
      spherical: true,
      query: {},
    });
  });

  it('filtre le carburant pendant le parcours géographique', () => {
    const [first] = nearStationsPipeline(StationSearch.create({ ...lyon, fuel: 'e85' }));

    expect(first.$geoNear.query).toEqual({ 'fuels.code': 'e85' });
  });

  it('filtre l’enseigne pendant le parcours, avant le plafond', () => {
    const [first] = nearStationsPipeline(
      StationSearch.create({ ...lyon, fuel: 'gazole', brand: 'TotalEnergies' }),
    );

    expect(first.$geoNear.query).toEqual({ 'fuels.code': 'gazole', brand: 'TotalEnergies' });
  });

  it('demande une station de plus que le plafond, pour détecter la coupure', () => {
    const stages = nearStationsPipeline(StationSearch.create(lyon));

    expect(stages.at(-1)).toEqual({ $limit: MAX_STATIONS + 1 });
  });

  it('au tri par distance, garde l’ordre de $geoNear', () => {
    const stages = nearStationsPipeline(StationSearch.create({ ...lyon, fuel: 'e10' }));

    expect(stages.some((stage: Document) => '$sort' in stage)).toBe(false);
  });

  it('au tri par prix, trie avant de couper : disponibles, puis prix, puis distance', () => {
    const stages = nearStationsPipeline(StationSearch.create({ ...lyon, fuel: 'e10', sort: 'price' }));
    const sortIndex = stages.findIndex((stage: Document) => '$sort' in stage);
    const limitIndex = stages.findIndex((stage: Document) => '$limit' in stage);

    expect(sortIndex).toBeGreaterThan(0);
    expect(sortIndex).toBeLessThan(limitIndex);
    expect(Object.keys(stages[sortIndex].$sort)).toEqual([
      'selectedFuel.available',
      'selectedFuel.price',
      'distanceMeters',
    ]);
    expect(JSON.stringify(stages[sortIndex - 1])).toContain('"e10"');
  });
});

describe('nearBrandsPipeline', () => {
  const lyon = { lat: '45.7578', lng: '4.8320' };

  it('compte les enseignes de la zone, carburant appliqué mais pas l’enseigne choisie', () => {
    const stages = nearBrandsPipeline(
      StationSearch.create({ ...lyon, radiusKm: '5', fuel: 'gazole', brand: 'TotalEnergies' }),
    );

    expect(stages[0].$geoNear).toMatchObject({ maxDistance: 5000, query: { 'fuels.code': 'gazole' } });
    expect(stages).toContainEqual({ $match: { brand: { $type: 'string' } } });
    expect(stages.at(-1)).toEqual({ $group: { _id: '$brand', stationCount: { $sum: 1 } } });
  });
});

describe('sortBrands', () => {
  it('range les enseignes dans l’ordre alphabétique français, accents compris', () => {
    const sorted = sortBrands([
      { brand: 'TotalEnergies', stationCount: 3 },
      { brand: 'Élan', stationCount: 1 },
      { brand: 'Esso', stationCount: 2 },
      { brand: 'Avia', stationCount: 1 },
    ]);

    expect(sorted.map((b) => b.brand)).toEqual(['Avia', 'Élan', 'Esso', 'TotalEnergies']);
  });
});

describe('toStationRow', () => {
  it('relit les coordonnées GeoJSON et convertit la distance en km', () => {
    const row = toStationRow({
      _id: '69003001',
      location: { type: 'Point', coordinates: [4.85491, 45.75938] },
      address: '12 avenue Félix Faure',
      city: 'Lyon',
      postcode: '69003',
      roadType: 'A',
      brand: 'Avia',
      name: 'Avia Lyon',
      fuels: [
        {
          code: 'gazole',
          price: 1.689,
          updatedAt: new Date('2026-10-26T07:42:00.000Z'),
          available: true,
          shortageSince: null,
        },
      ],
      distanceMeters: 1234.4,
    });

    expect(row).toMatchObject({
      id: '69003001',
      latitude: 45.75938,
      longitude: 4.85491,
      distanceKm: 1.234,
      roadType: 'A',
      brand: 'Avia',
      name: 'Avia Lyon',
    });
    expect(row.fuels).toHaveLength(1);
  });

  it('tolère un document partiel', () => {
    const row = toStationRow({ _id: '1', location: { type: 'Point', coordinates: [2.35, 48.85] } });

    expect(row).toMatchObject({
      address: '',
      city: '',
      roadType: null,
      brand: null,
      name: null,
      distanceKm: 0,
      fuels: [],
    });
  });
});

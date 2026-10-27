import { InvalidStationSearch } from './fuel.errors';
import { DEFAULT_RADIUS_KM, MAX_RADIUS_KM, StationSearch } from './station-search';

describe('StationSearch', () => {
  const lyon = { lat: '45.7578', lng: '4.8320' };

  it('applique les valeurs par défaut', () => {
    const search = StationSearch.create(lyon);

    expect(search).toMatchObject({
      latitude: 45.7578,
      longitude: 4.832,
      radiusKm: DEFAULT_RADIUS_KM,
      fuel: null,
      sort: 'distance',
      brand: null,
    });
    expect(search.radiusMeters).toBe(DEFAULT_RADIUS_KM * 1000);
  });

  it('accepte un carburant, un rayon et le tri par prix', () => {
    const search = StationSearch.create({ ...lyon, fuel: 'e10', radiusKm: '5', sort: 'price' });

    expect(search).toMatchObject({ fuel: 'e10', radiusKm: 5, sort: 'price' });
  });

  it('traite une valeur vide comme absente', () => {
    expect(StationSearch.create({ ...lyon, fuel: '', radiusKm: '', sort: '', brand: '  ' })).toMatchObject({
      fuel: null,
      brand: null,
      radiusKm: DEFAULT_RADIUS_KM,
      sort: 'distance',
    });
  });

  it('garde l’enseigne telle quelle, espaces de bord retirés', () => {
    expect(StationSearch.create({ ...lyon, brand: ' TotalEnergies ' }).brand).toBe('TotalEnergies');
  });

  it.each([
    [{ lng: '4.8' }, '« lat » est obligatoire'],
    [{ lat: '45.7' }, '« lng » est obligatoire'],
    [{ ...lyon, lat: '91' }, '« lat »'],
    [{ ...lyon, lng: 'abc' }, '« lng »'],
    [{ ...lyon, radiusKm: '0' }, '« radiusKm »'],
    [{ ...lyon, radiusKm: String(MAX_RADIUS_KM + 1) }, '« radiusKm »'],
    [{ ...lyon, fuel: 'kerosene' }, '« fuel »'],
    [{ ...lyon, sort: 'name' }, '« sort »'],
    [{ ...lyon, brand: 'x'.repeat(61) }, '« brand »'],
  ])('refuse %j', (raw, message) => {
    expect(() => StationSearch.create(raw)).toThrow(InvalidStationSearch);
    expect(() => StationSearch.create(raw)).toThrow(message);
  });

  it('refuse le tri par prix sans carburant : quel prix comparer ?', () => {
    expect(() => StationSearch.create({ ...lyon, sort: 'price' })).toThrow(
      'Le tri « price » exige un carburant',
    );
  });
});

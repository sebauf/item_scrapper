import { describe, expect, it } from 'vitest';
import { aFuelPrice, aFuelStation } from '@/testing/fixtures';
import {
  buildFuelApiQuery,
  buildFuelPageHref,
  DEFAULT_CENTER,
  formatDistance,
  formatLiterPrice,
  parseFuelSearchParams,
  priceTiers,
} from './fuel';

describe('parseFuelSearchParams', () => {
  it('sans paramètre : Paris, Gazole, 10 km, tri par prix', () => {
    expect(parseFuelSearchParams({})).toEqual({
      lat: DEFAULT_CENTER.lat,
      lng: DEFAULT_CENTER.lng,
      radiusKm: 10,
      fuel: 'gazole',
      sort: 'price',
      located: false,
    });
  });

  it('lit une position, un rayon et un carburant valides', () => {
    expect(
      parseFuelSearchParams({ lat: '45.7578', lng: '4.832', radius: '5', fuel: 'e85', sort: 'distance' }),
    ).toEqual({ lat: 45.7578, lng: 4.832, radiusKm: 5, fuel: 'e85', sort: 'distance', located: true });
  });

  it('retombe sur les défauts devant des valeurs aberrantes', () => {
    expect(
      parseFuelSearchParams({ lat: '200', lng: '4', radius: '7', fuel: 'kerosene', sort: 'nom' }),
    ).toMatchObject({ lat: DEFAULT_CENTER.lat, located: false, radiusKm: 10, fuel: 'gazole', sort: 'price' });
  });

  it('fuel=all : tous les carburants, donc tri par distance obligatoire', () => {
    expect(parseFuelSearchParams({ fuel: 'all', sort: 'price' })).toMatchObject({
      fuel: null,
      sort: 'distance',
    });
  });
});

describe('buildFuelApiQuery', () => {
  it('envoie toujours la position et le rayon, arrondis', () => {
    const query = buildFuelApiQuery(parseFuelSearchParams({ lat: '45.757812', lng: '4.83204' }));

    expect(query).toBe('?lat=45.7578&lng=4.8320&radiusKm=10&sort=price&fuel=gazole');
  });

  it('omet le carburant quand on les veut tous', () => {
    expect(buildFuelApiQuery(parseFuelSearchParams({ fuel: 'all' }))).not.toContain('fuel=');
  });
});

describe('buildFuelPageHref', () => {
  it('omet les défauts', () => {
    expect(buildFuelPageHref(parseFuelSearchParams({}))).toBe('/fuel');
  });

  it('fait l’aller-retour avec parseFuelSearchParams', () => {
    const params = parseFuelSearchParams({ lat: '45.7578', lng: '4.832', radius: '20', fuel: 'all' });
    const href = buildFuelPageHref(params);
    const parsed = parseFuelSearchParams(Object.fromEntries(new URL(href, 'http://x').searchParams));

    expect(href).toBe('/fuel?lat=45.7578&lng=4.8320&radius=20&fuel=all');
    expect(parsed).toEqual(params);
  });

  it('ne fige pas la position par défaut dans l’URL', () => {
    expect(buildFuelPageHref({ ...parseFuelSearchParams({}), fuel: 'e10' })).toBe('/fuel?fuel=e10');
  });
});

describe('formats', () => {
  it('affiche le prix au millième, comme à la pompe', () => {
    expect(formatLiterPrice(1.689).replace(/\s/g, ' ')).toBe('1,689 €');
  });

  it('affiche la distance en mètres sous le kilomètre', () => {
    expect(formatDistance(0.4)).toBe('400 m');
    expect(formatDistance(12.345)).toBe('12,3 km');
  });
});

describe('priceTiers', () => {
  const stationAt = (id: string, price: number, available = true) =>
    aFuelStation({ id, fuels: [aFuelPrice({ code: 'e10', price, available })] });

  it('classe en tiers parmi les prix disponibles', () => {
    const tierOf = priceTiers(
      [stationAt('a', 1.7), stationAt('b', 1.75), stationAt('c', 1.8), stationAt('d', 0.5, false)],
      'e10',
    );

    expect([tierOf(1.7), tierOf(1.75), tierOf(1.8)]).toEqual(['low', 'mid', 'high']);
  });

  it('ne classe rien sous trois prix comparables', () => {
    const tierOf = priceTiers([stationAt('a', 1.7), stationAt('b', 1.8)], 'e10');

    expect(tierOf(1.7)).toBeNull();
  });
});

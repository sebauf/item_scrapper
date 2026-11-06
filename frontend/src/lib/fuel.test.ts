import { describe, expect, it } from 'vitest';
import { aFavoriteFuel, aFuelPrice, aFuelStation } from '@/testing/fixtures';
import {
  brandOptions,
  buildFuelApiQuery,
  buildFuelPageHref,
  DEFAULT_CENTER,
  formatDeadline,
  formatDistance,
  formatLiterPrice,
  formatRisk,
  googleMapsUrl,
  latestComputedAt,
  outlookSentence,
  restockSentence,
  parseFuelSearchParams,
  priceTiers,
  sortFuels,
  stationLabel,
  worstRiskLevel,
} from './fuel';

describe('parseFuelSearchParams', () => {
  it('sans paramètre : Paris, Gazole, 10 km, tri par prix', () => {
    expect(parseFuelSearchParams({})).toEqual({
      lat: DEFAULT_CENTER.lat,
      lng: DEFAULT_CENTER.lng,
      radiusKm: 10,
      fuel: 'gazole',
      sort: 'price',
      brand: 'TotalEnergies',
      located: false,
    });
  });

  it('lit une position, un rayon et un carburant valides', () => {
    expect(
      parseFuelSearchParams({ lat: '45.7578', lng: '4.832', radius: '5', fuel: 'e85', sort: 'distance' }),
    ).toEqual({
      lat: 45.7578,
      lng: 4.832,
      radiusKm: 5,
      fuel: 'e85',
      sort: 'distance',
      brand: 'TotalEnergies',
      located: true,
    });
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

describe('enseigne', () => {
  it('TotalEnergies par défaut, toutes avec brand=all, sinon celle demandée', () => {
    expect(parseFuelSearchParams({}).brand).toBe('TotalEnergies');
    expect(parseFuelSearchParams({ brand: 'all' }).brand).toBeNull();
    expect(parseFuelSearchParams({ brand: ' E.Leclerc ' }).brand).toBe('E.Leclerc');
  });

  it('retombe sur le défaut devant une enseigne vide ou démesurée', () => {
    expect(parseFuelSearchParams({ brand: '' }).brand).toBe('TotalEnergies');
    expect(parseFuelSearchParams({ brand: 'x'.repeat(61) }).brand).toBe('TotalEnergies');
  });

  it('transmet l’enseigne à l’API, sauf quand on les veut toutes', () => {
    expect(buildFuelApiQuery(parseFuelSearchParams({}))).toContain('brand=TotalEnergies');
    expect(buildFuelApiQuery(parseFuelSearchParams({ brand: 'all' }))).not.toContain('brand=');
  });

  it('fait l’aller-retour dans l’URL de la page, défaut omis', () => {
    const base = parseFuelSearchParams({});
    expect(buildFuelPageHref(base)).toBe('/fuel');
    expect(buildFuelPageHref({ ...base, brand: null })).toBe('/fuel?brand=all');

    const href = buildFuelPageHref({ ...base, brand: 'Système U' });
    const parsed = parseFuelSearchParams(Object.fromEntries(new URL(href, 'http://x').searchParams));
    expect(parsed.brand).toBe('Système U');
  });

  it('propose l’enseigne choisie même absente de la zone', () => {
    const brands = [
      { brand: 'Avia', stationCount: 1 },
      { brand: 'Esso', stationCount: 2 },
    ];

    expect(brandOptions(brands, 'Esso')).toBe(brands);
    expect(brandOptions(brands, null)).toBe(brands);
    expect(brandOptions(brands, 'Carrefour').map((b) => [b.brand, b.stationCount])).toEqual([
      ['Avia', 1],
      ['Carrefour', 0],
      ['Esso', 2],
    ]);
  });
});

describe('buildFuelApiQuery', () => {
  it('envoie toujours la position et le rayon, arrondis', () => {
    const query = buildFuelApiQuery(parseFuelSearchParams({ lat: '45.757812', lng: '4.83204' }));

    expect(query).toBe('?lat=45.7578&lng=4.8320&radiusKm=10&sort=price&fuel=gazole&brand=TotalEnergies');
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

describe('googleMapsUrl', () => {
  const queryOf = (url: string) => new URL(url).searchParams.get('query');

  it('cherche la station par enseigne et adresse complète', () => {
    const url = new URL(googleMapsUrl(aFuelStation()));

    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/search/');
    expect(url.searchParams.get('api')).toBe('1');
    expect(url.searchParams.get('query')).toBe('TotalEnergies, 12 avenue Félix Faure, 69003 Lyon');
  });

  it('prend le nom OSM sans enseigne, et rien sans l’un ni l’autre', () => {
    expect(queryOf(googleMapsUrl(aFuelStation({ brand: null, name: 'Garage du Centre' })))).toBe(
      'Garage du Centre, 12 avenue Félix Faure, 69003 Lyon',
    );
    expect(queryOf(googleMapsUrl(aFuelStation({ brand: null, name: null })))).toBe(
      '12 avenue Félix Faure, 69003 Lyon',
    );
  });

  it('se rabat sur les coordonnées sans adresse', () => {
    expect(queryOf(googleMapsUrl(aFuelStation({ address: '  ', latitude: 45.75938, longitude: 4.85491 })))).toBe(
      '45.75938,4.85491',
    );
  });
});

describe('stationLabel', () => {
  it('enseigne en titre, nom OSM en complément', () => {
    expect(stationLabel(aFuelStation({ brand: 'Esso', name: 'Esso Aire de Saint Rémy (A31)' }))).toEqual({
      title: 'Esso',
      detail: 'Esso Aire de Saint Rémy (A31)',
    });
  });

  it('n’affiche pas un nom qui répète l’enseigne', () => {
    expect(stationLabel(aFuelStation({ brand: 'E.Leclerc', name: 'E. Leclerc' })).detail).toBeNull();
  });

  it('se rabat sur le nom sans enseigne, puis le dit', () => {
    expect(stationLabel(aFuelStation({ brand: null, name: 'Garage du Centre' })).title).toBe('Garage du Centre');
    expect(stationLabel(aFuelStation({ brand: null, name: null })).title).toBe('Enseigne inconnue');
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

describe('prévision de rupture', () => {
  // 5 nov. 2026, 12:00 UTC = 13:00 à Paris (heure d'hiver, UTC+1).
  const now = new Date('2026-11-05T12:00:00.000Z');

  it('formate la probabilité en pourcentage entier', () => {
    expect(formatRisk(0.623)).toBe('62 %');
    expect(formatRisk(0)).toBe('0 %');
    expect(formatRisk(0.004)).toBe('< 1 %');
    expect(formatRisk(1)).toBe('100 %');
  });

  it('écrit l’échéance en heure de Paris, relative au jour', () => {
    expect(formatDeadline('2026-11-05T17:30:00.000Z', now)).toBe('aujourd’hui à 18:30');
    expect(formatDeadline('2026-11-06T10:30:00.000Z', now)).toBe('demain à 11:30');
    // 23:30 UTC le 5 = 00:30 le 6 à Paris : c'est déjà « demain ».
    expect(formatDeadline('2026-11-05T23:30:00.000Z', now)).toBe('demain à 00:30');
    expect(formatDeadline('2026-11-07T10:30:00.000Z', now)).toBe('le sam. 7 nov. à 11:30');
  });

  it('formule la prévision comme une échéance, jamais comme une heure de rupture', () => {
    const outlook = {
      risk: 0.62,
      level: 'likely' as const,
      computedAt: '2026-11-05T11:30:00.000Z',
      horizonEnd: '2026-11-06T11:30:00.000Z',
    };
    expect(outlookSentence(outlook, now)).toBe('Rupture probable avant demain à 12:30');
    expect(outlookSentence({ ...outlook, level: 'elevated' }, now)).toBe(
      'Risque de rupture élevé d’ici demain à 12:30',
    );
    expect(outlookSentence({ ...outlook, level: 'low' }, now)).toBe(
      'Pas de rupture attendue d’ici demain à 12:30',
    );
  });

  it('formule le retour comme une échéance, jamais comme une heure de livraison', () => {
    const outlook = {
      probability: 0.71,
      level: 'likely' as const,
      computedAt: '2026-11-05T11:30:00.000Z',
      horizonEnd: '2026-11-06T11:30:00.000Z',
    };
    expect(restockSentence(outlook, now)).toBe('Retour probable avant demain à 12:30');
    expect(restockSentence({ ...outlook, level: 'possible' }, now)).toBe(
      'Retour possible d’ici demain à 12:30',
    );
    expect(restockSentence({ ...outlook, level: 'unlikely' }, now)).toBe(
      'Retour peu probable d’ici demain à 12:30',
    );
  });

  it('retient le calcul le plus récent des deux prévisions', () => {
    expect(latestComputedAt(null, null)).toBeNull();
    expect(latestComputedAt('2026-11-05T11:00:00.000Z', null)).toBe('2026-11-05T11:00:00.000Z');
    expect(latestComputedAt('2026-11-05T11:00:00.000Z', '2026-11-05T11:30:00.000Z')).toBe(
      '2026-11-05T11:30:00.000Z',
    );
  });

  it('retient le pire niveau des carburants prévus', () => {
    const outlook = (level: 'low' | 'elevated' | 'likely') => ({
      risk: 0.1,
      level,
      computedAt: now.toISOString(),
      horizonEnd: now.toISOString(),
    });
    expect(worstRiskLevel([])).toBeNull();
    expect(worstRiskLevel([aFavoriteFuel()])).toBeNull();
    expect(
      worstRiskLevel([
        aFavoriteFuel({ shortageOutlook: outlook('low') }),
        aFavoriteFuel({ shortageOutlook: outlook('elevated') }),
        aFavoriteFuel(),
      ]),
    ).toBe('elevated');
  });

  it('range les carburants du plus vendu au plus rare', () => {
    const sorted = sortFuels([aFavoriteFuel({ code: 'e85' }), aFavoriteFuel({ code: 'gazole' }), aFavoriteFuel({ code: 'e10' })]);
    expect(sorted.map((f) => f.code)).toEqual(['gazole', 'e10', 'e85']);
  });
});

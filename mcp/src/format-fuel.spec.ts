import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatFavoriteFuel,
  formatFavoriteStations,
  formatFuelPrice,
  formatFuelStationSearch,
} from './format-fuel.js';
import {
  aFavoriteStationDetailsList,
  aFuelPrice,
  aFuelStation,
  aFuelStationSearch,
} from './testing/fixtures.js';

describe('formatFuelPrice', () => {
  it('affiche le prix au millième, comme à la pompe, avec sa date de déclaration', () => {
    assert.equal(formatFuelPrice(aFuelPrice()), 'Gazole : 1.689 €/L (déclaré 2026-11-08 09:12)');
  });

  it("signale un prix ancien sans le cacher (il peut n'avoir pas changé)", () => {
    assert.match(formatFuelPrice(aFuelPrice({ isStale: true })), /1\.689 €\/L \(ANCIEN, déclaré/);
  });

  it('affiche une rupture et son début', () => {
    assert.equal(
      formatFuelPrice(
        aFuelPrice({ code: 'e10', price: null, available: false, shortageSince: '2026-11-07T17:00:00.000Z' }),
      ),
      'SP95-E10 : RUPTURE depuis 2026-11-07 18:00',
    );
  });
});

describe('formatFuelStationSearch', () => {
  const display = { radiusKm: 10, fuel: undefined, limit: 10 };

  it("garde l'identifiant officiel, seule clé de add_favorite_station", () => {
    const output = formatFuelStationSearch(aFuelStationSearch(), display);

    assert.match(output, /id: 69003001/);
    assert.match(output, /TotalEnergies — 12 avenue Félix Faure, 69003 Lyon — 1\.2 km/);
  });

  it("cite OpenStreetMap quand il affiche des enseignes (ODbL l'exige)", () => {
    const output = formatFuelStationSearch(aFuelStationSearch(), display);

    assert.match(output, /TotalEnergies \(1\).*OpenStreetMap \(ODbL\)/);
  });

  it("n'affiche que le carburant demandé quand un filtre est posé", () => {
    const output = formatFuelStationSearch(aFuelStationSearch(), { ...display, fuel: 'gazole' });

    assert.match(output, /Gazole : 1\.689/);
    assert.doesNotMatch(output, /SP95-E10/);
  });

  it('coupe à la limite demandée et le dit', () => {
    const stations = [aFuelStation({ id: '1' }), aFuelStation({ id: '2' }), aFuelStation({ id: '3' })];

    const output = formatFuelStationSearch(aFuelStationSearch({ stations }), { ...display, limit: 2 });

    assert.match(output, /3 station\(s\).*les 2 premières affichées/);
    assert.match(output, /id: 2/);
    assert.doesNotMatch(output, /id: 3/);
  });

  it('signale la coupure du backend (plafond de 200 stations)', () => {
    const output = formatFuelStationSearch(aFuelStationSearch({ truncated: true }), display);

    assert.match(output, /plus de 1 station/);
  });

  it('marque les stations déjà favorites', () => {
    const output = formatFuelStationSearch(
      aFuelStationSearch({ stations: [aFuelStation({ isFavorite: true })] }),
      display,
    );

    assert.match(output, /— FAVORITE/);
  });

  it('suggère quoi faire quand rien ne correspond', () => {
    const output = formatFuelStationSearch(aFuelStationSearch({ stations: [], brands: [] }), display);

    assert.match(output, /Aucune station ne correspond/);
  });
});

describe('formatFavoriteFuel', () => {
  const [favorite] = aFavoriteStationDetailsList().stations;
  const [gazole, e10] = favorite.station!.fuels;

  // « Avant <fin de l'horizon> » : le modèle prédit un événement dans les 24 h,
  // pas une heure d'événement — on ne lui fait pas dire plus.
  it("énonce le risque de rupture comme une probabilité avant la fin de l'horizon", () => {
    assert.match(
      formatFavoriteFuel(gazole),
      /risque de rupture avant 2026-11-09 14:30 : 62 % \(probable\)/,
    );
  });

  it('énonce la chance de retour pour un carburant en rupture', () => {
    assert.match(
      formatFavoriteFuel(e10),
      /RUPTURE depuis .* retour à la pompe avant 2026-11-09 14:30 : 71 % \(probable\)/,
    );
  });

  it("dit qu'il n'y a pas de prévision plutôt que de se taire", () => {
    assert.match(formatFavoriteFuel({ ...gazole, shortageOutlook: null }), /pas de prévision de rupture/);
    assert.match(formatFavoriteFuel({ ...e10, restockOutlook: null }), /pas de prévision de retour/);
  });
});

describe('formatFavoriteStations', () => {
  it('rend les stations, leurs coordonnées et les seuils des prévisions', () => {
    const output = formatFavoriteStations(aFavoriteStationDetailsList());

    assert.match(output, /2 station\(s\) favorite\(s\)/);
    assert.match(output, /position: 45\.75938, 4\.85491/);
    assert.match(output, /élevé ≥ 15 %, probable ≥ 50 %/);
    assert.match(output, /possible ≥ 20 %/);
  });

  it('garde une favorite sortie du flux, avec son id pour pouvoir la retirer', () => {
    const output = formatFavoriteStations(aFavoriteStationDetailsList());

    assert.match(output, /Station 75001002 — absente du flux officiel/);
    assert.match(output, /id: 75001002/);
  });

  it('explique comment ajouter une favorite quand il n’y en a aucune', () => {
    const output = formatFavoriteStations(aFavoriteStationDetailsList({ stations: [] }));

    assert.match(output, /find_fuel_stations.*add_favorite_station/s);
  });
});

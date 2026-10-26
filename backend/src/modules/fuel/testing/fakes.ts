import {
  FuelPriceRow,
  FuelStationReadModel,
  FuelStationRow,
  NearbyStations,
} from '../application/ports/fuel-station.read-model';
import { StationSearch } from '../domain/station-search';

/**
 * Doubles du contexte Fuel. Le vrai read model est une agrégation `$geoNear`
 * qui exige un serveur Mongo ; tout le reste — validation de la recherche,
 * politique de fraîcheur, contrat HTTP — se teste avec ce double.
 */
export function aFuelPrice(overrides: Partial<FuelPriceRow> = {}): FuelPriceRow {
  return {
    code: 'gazole',
    price: 1.689,
    updatedAt: new Date('2026-10-26T07:42:00.000Z'),
    available: true,
    shortageSince: null,
    ...overrides,
  };
}

export function aFuelStation(overrides: Partial<FuelStationRow> = {}): FuelStationRow {
  return {
    id: '69003001',
    address: '12 avenue Félix Faure',
    city: 'Lyon',
    postcode: '69003',
    roadType: 'R',
    latitude: 45.75938,
    longitude: 4.85491,
    distanceKm: 1.234,
    fuels: [aFuelPrice()],
    ...overrides,
  };
}

export const EMPTY_NEARBY: NearbyStations = { stations: [], truncated: false, lastImportAt: null };

export class FakeFuelStationReadModel extends FuelStationReadModel {
  readonly calls: StationSearch[] = [];

  constructor(private readonly result: NearbyStations = EMPTY_NEARBY) {
    super();
  }

  findNear(search: StationSearch): Promise<NearbyStations> {
    this.calls.push(search);
    return Promise.resolve(this.result);
  }
}

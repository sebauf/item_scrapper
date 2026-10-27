import { FuelType } from '../../domain/fuel-type';
import { StationSearch } from '../../domain/station-search';

/** Un carburant tel que stocké par l'import, dates encore en `Date`. */
export interface FuelPriceRow {
  code: FuelType;
  /** null pendant une rupture temporaire déclarée sans prix. */
  price: number | null;
  /** Date de déclaration par la station — pas celle de notre import. */
  updatedAt: Date | null;
  available: boolean;
  shortageSince: Date | null;
}

export interface FuelStationRow {
  id: string;
  /**
   * Enseigne unifiée (« TotalEnergies », « E.Leclerc »…), d'après OpenStreetMap
   * — le flux officiel ne la donne pas. null si la station n'y est pas
   * rapprochée.
   */
  brand: string | null;
  /** Nom de la station sur OpenStreetMap, null si inconnu. */
  name: string | null;
  address: string;
  city: string;
  postcode: string;
  /** R = route, A = autoroute. */
  roadType: 'R' | 'A' | null;
  latitude: number;
  longitude: number;
  distanceKm: number;
  fuels: FuelPriceRow[];
}

export interface BrandCount {
  brand: string;
  /** Stations de l'enseigne dans le rayon (et vendant le carburant demandé). */
  stationCount: number;
}

export interface NearbyStations {
  /** Déjà triées selon `StationSearch.sort`, au plus `MAX_STATIONS`. */
  stations: FuelStationRow[];
  /** Vrai si d'autres stations correspondaient au-delà du plafond. */
  truncated: boolean;
  /**
   * Enseignes de la zone, filtre enseigne **non** appliqué, triées par ordre
   * alphabétique français.
   */
  brands: BrandCount[];
  /** Dernier import réussi du flux, null sur une base vide. */
  lastImportAt: Date | null;
}

/**
 * Port de lecture du contexte Fuel. `fuel_stations` est écrite par le
 * pipeline ; le backend ne fait que la lire.
 */
export abstract class FuelStationReadModel {
  abstract findNear(search: StationSearch): Promise<NearbyStations>;

  /** Vrai si la station figure dans le dernier import du flux. */
  abstract exists(stationId: string): Promise<boolean>;
}

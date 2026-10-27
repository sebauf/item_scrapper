import { FUEL_TYPES, FuelType, isFuelType } from './fuel-type';
import { InvalidStationSearch } from './fuel.errors';

export const STATION_SORT_OPTIONS = ['distance', 'price'] as const;
export type StationSort = (typeof STATION_SORT_OPTIONS)[number];

export const DEFAULT_RADIUS_KM = 10;
/**
 * Au-delà, une recherche autour d'une grande ville renverrait des milliers de
 * stations : illisible sur une carte, et lourd à sérialiser pour rien.
 */
export const MAX_RADIUS_KM = 30;
/** Plafond du nombre de stations renvoyées — la réponse signale la coupure. */
export const MAX_STATIONS = 200;
/** Le plus long libellé unifié (« Intermarché Contact »…) en est loin. */
export const MAX_BRAND_LENGTH = 60;

export interface RawStationSearch {
  lat?: string;
  lng?: string;
  radiusKm?: string;
  fuel?: string;
  sort?: string;
  brand?: string;
}

/**
 * Objet-valeur : une recherche de stations autour d'un point.
 *
 * Comme `ProductQuery`, il est strict (400 sur une valeur aberrante) ; c'est le
 * frontend qui reste indulgent avec l'URL tapée à la main.
 *
 * Le tri par prix n'a de sens que pour un carburant donné — sans `fuel`, quel
 * prix comparerait-on ? La combinaison est donc refusée plutôt qu'interprétée.
 *
 * `brand` est comparée **à l'identique** au libellé unifié écrit par l'import
 * (`pipeline/src/fuel/brands.py` ramène déjà « Total Access », « Total »… à
 * « TotalEnergies ») : le frontend propose les enseignes que l'API lui renvoie,
 * il n'a pas à deviner une orthographe.
 */
export class StationSearch {
  private constructor(
    readonly latitude: number,
    readonly longitude: number,
    readonly radiusKm: number,
    readonly fuel: FuelType | null,
    readonly sort: StationSort,
    readonly brand: string | null,
  ) {}

  static create(raw: RawStationSearch): StationSearch {
    const latitude = StationSearch.parseCoordinate(raw.lat, 'lat', 90);
    const longitude = StationSearch.parseCoordinate(raw.lng, 'lng', 180);
    const radiusKm = StationSearch.parseRadius(raw.radiusKm);
    const fuel = StationSearch.parseFuel(raw.fuel);
    const sort = StationSearch.parseSort(raw.sort);
    const brand = StationSearch.parseBrand(raw.brand);

    if (sort === 'price' && fuel === null) {
      throw new InvalidStationSearch('Le tri « price » exige un carburant (« fuel »).');
    }

    return new StationSearch(latitude, longitude, radiusKm, fuel, sort, brand);
  }

  get radiusMeters(): number {
    return this.radiusKm * 1000;
  }

  private static parseCoordinate(raw: string | undefined, field: string, limit: number): number {
    if (raw === undefined || raw === '') {
      throw new InvalidStationSearch(`« ${field} » est obligatoire.`);
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || Math.abs(value) > limit) {
      throw new InvalidStationSearch(`« ${field} » attend un nombre entre -${limit} et ${limit}.`);
    }
    return value;
  }

  private static parseRadius(raw: string | undefined): number {
    if (raw === undefined || raw === '') return DEFAULT_RADIUS_KM;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0 || value > MAX_RADIUS_KM) {
      throw new InvalidStationSearch(`« radiusKm » attend un nombre entre 0 et ${MAX_RADIUS_KM}.`);
    }
    return value;
  }

  private static parseFuel(raw: string | undefined): FuelType | null {
    if (raw === undefined || raw === '') return null;
    if (!isFuelType(raw)) {
      throw new InvalidStationSearch(`« fuel » attend l'un de : ${FUEL_TYPES.join(', ')}.`);
    }
    return raw;
  }

  private static parseBrand(raw: string | undefined): string | null {
    const brand = raw?.trim() ?? '';
    if (brand === '') return null;
    if (brand.length > MAX_BRAND_LENGTH) {
      throw new InvalidStationSearch(`« brand » attend au plus ${MAX_BRAND_LENGTH} caractères.`);
    }
    return brand;
  }

  private static parseSort(raw: string | undefined): StationSort {
    if (raw === undefined || raw === '') return 'distance';
    if (!(STATION_SORT_OPTIONS as readonly string[]).includes(raw)) {
      throw new InvalidStationSearch(
        `« sort » attend l'une de : ${STATION_SORT_OPTIONS.join(', ')}.`,
      );
    }
    return raw as StationSort;
  }
}

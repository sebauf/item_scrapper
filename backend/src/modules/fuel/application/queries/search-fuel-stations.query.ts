import { Injectable } from '@nestjs/common';
import { FavoriteStationRepository } from '../../domain/favorite-station.repository';
import { FuelType } from '../../domain/fuel-type';
import { isStale, STALE_AFTER_HOURS } from '../../domain/freshness-policy';
import { RawStationSearch, StationSearch } from '../../domain/station-search';
import { FuelPriceRow, FuelStationReadModel, FuelStationRow } from '../ports/fuel-station.read-model';

export interface FuelPriceView {
  code: FuelType;
  price: number | null;
  updatedAt: string | null;
  available: boolean;
  shortageSince: string | null;
  /** Verdict de la politique de fraîcheur, déjà appliqué. */
  isStale: boolean;
}

export interface FuelStationView extends Omit<FuelStationRow, 'fuels'> {
  fuels: FuelPriceView[];
  /** Station favorite — c'est aussi elle que surveille l'alerte de réapprovisionnement. */
  isFavorite: boolean;
}

export interface FuelStationSearchResult {
  stations: FuelStationView[];
  truncated: boolean;
  lastImportAt: string | null;
  /** Seuil appliqué pour `isStale`, pour que l'écran puisse l'expliquer. */
  staleAfterHours: number;
}

/**
 * Stations autour d'un point, avec la fraîcheur de chaque prix déjà jugée et
 * l'état favori de chacune.
 *
 * Le favori est marqué ici plutôt que joint dans l'agrégation `$geoNear` : la
 * liste des favorites tient en quelques entrées, et le read model reste une
 * lecture pure de `fuel_stations`.
 *
 * `now` est un paramètre plutôt qu'un `new Date()` enfoui : c'est ce qui rend
 * la politique de fraîcheur testable sans horloge truquée.
 */
@Injectable()
export class SearchFuelStationsQuery {
  constructor(
    private readonly readModel: FuelStationReadModel,
    private readonly favorites: FavoriteStationRepository,
  ) {}

  async execute(raw: RawStationSearch, now: Date = new Date()): Promise<FuelStationSearchResult> {
    const search = StationSearch.create(raw);
    const [{ stations, truncated, lastImportAt }, favorites] = await Promise.all([
      this.readModel.findNear(search),
      this.favorites.list(),
    ]);
    const favoriteIds = new Set(favorites.map((entry) => entry.stationId));

    return {
      stations: stations.map((station) => toView(station, now, favoriteIds)),
      truncated,
      lastImportAt: lastImportAt?.toISOString() ?? null,
      staleAfterHours: STALE_AFTER_HOURS,
    };
  }
}

function toView(station: FuelStationRow, now: Date, favoriteIds: Set<string>): FuelStationView {
  return {
    ...station,
    fuels: station.fuels.map((fuel) => toFuelView(fuel, now)),
    isFavorite: favoriteIds.has(station.id),
  };
}

function toFuelView(fuel: FuelPriceRow, now: Date): FuelPriceView {
  return {
    code: fuel.code,
    price: fuel.price,
    updatedAt: fuel.updatedAt?.toISOString() ?? null,
    available: fuel.available,
    shortageSince: fuel.shortageSince?.toISOString() ?? null,
    isStale: isStale(fuel.updatedAt, now),
  };
}

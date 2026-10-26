import { Injectable } from '@nestjs/common';
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
}

export interface FuelStationSearchResult {
  stations: FuelStationView[];
  truncated: boolean;
  lastImportAt: string | null;
  /** Seuil appliqué pour `isStale`, pour que l'écran puisse l'expliquer. */
  staleAfterHours: number;
}

/**
 * Stations autour d'un point, avec la fraîcheur de chaque prix déjà jugée.
 *
 * `now` est un paramètre plutôt qu'un `new Date()` enfoui : c'est ce qui rend
 * la politique de fraîcheur testable sans horloge truquée.
 */
@Injectable()
export class SearchFuelStationsQuery {
  constructor(private readonly readModel: FuelStationReadModel) {}

  async execute(raw: RawStationSearch, now: Date = new Date()): Promise<FuelStationSearchResult> {
    const search = StationSearch.create(raw);
    const { stations, truncated, lastImportAt } = await this.readModel.findNear(search);

    return {
      stations: stations.map((station) => toView(station, now)),
      truncated,
      lastImportAt: lastImportAt?.toISOString() ?? null,
      staleAfterHours: STALE_AFTER_HOURS,
    };
  }
}

function toView(station: FuelStationRow, now: Date): FuelStationView {
  return { ...station, fuels: station.fuels.map((fuel) => toFuelView(fuel, now)) };
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

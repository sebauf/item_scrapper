import { Injectable } from '@nestjs/common';
import { UserId } from 'src/shared/domain/user-id';
import { FavoriteStationRepository } from '../../domain/favorite-station.repository';
import { STALE_AFTER_HOURS } from '../../domain/freshness-policy';
import {
  LIKELY_RESTOCK_THRESHOLD,
  POSSIBLE_RESTOCK_THRESHOLD,
  PublishedRestockForecast,
  RestockChanceLevel,
  restockOutlook,
} from '../../domain/restock-forecast-policy';
import {
  ELEVATED_SHORTAGE_THRESHOLD,
  FORECAST_HORIZON_HOURS,
  FORECAST_MAX_AGE_HOURS,
  LIKELY_SHORTAGE_THRESHOLD,
  PublishedForecast,
  ShortageRiskLevel,
  shortageOutlook,
} from '../../domain/shortage-forecast-policy';
import { FuelStationReadModel, StationRow } from '../ports/fuel-station.read-model';
import { RestockForecastReadModel } from '../ports/restock-forecast.read-model';
import { ShortageForecastReadModel } from '../ports/shortage-forecast.read-model';
import { FuelPriceView, toFuelView } from './search-fuel-stations.query';

export interface ShortageOutlookView {
  risk: number;
  level: ShortageRiskLevel;
  computedAt: string;
  horizonEnd: string;
}

export interface RestockOutlookView {
  probability: number;
  level: RestockChanceLevel;
  computedAt: string;
  horizonEnd: string;
}

export interface FavoriteFuelView extends FuelPriceView {
  /** Carburant disponible — null : pas de prévision (cf. `shortageOutlook`). */
  shortageOutlook: ShortageOutlookView | null;
  /** Carburant en rupture — null : pas de prévision (cf. `restockOutlook`). */
  restockOutlook: RestockOutlookView | null;
}

export interface FavoriteStationDetailsView {
  id: string;
  addedAt: string;
  /**
   * null : la station n'est plus dans le flux officiel (fermée, ou absente du
   * dernier import). La favorite est gardée — elle redevient utile si la
   * station revient — mais il n'y a ni prix ni prévision à montrer.
   */
  station: (Omit<StationRow, 'id' | 'fuels'> & { fuels: FavoriteFuelView[] }) | null;
}

export interface FavoriteStationDetailsResult {
  stations: FavoriteStationDetailsView[];
  staleAfterHours: number;
  /** Les règles appliquées, pour que l'écran puisse les expliquer. */
  forecast: {
    horizonHours: number;
    maxAgeHours: number;
    elevatedThreshold: number;
    likelyThreshold: number;
    /** Prévision retenue la plus récente, null si aucune. */
    computedAt: string | null;
  };
  /** Idem pour la prévision de réapprovisionnement (carburants en rupture). */
  restockForecast: {
    horizonHours: number;
    maxAgeHours: number;
    possibleThreshold: number;
    likelyThreshold: number;
    computedAt: string | null;
  };
}

/**
 * Les stations favorites de `owner` avec leurs prix et, pour chaque carburant,
 * une prévision à 24 h : de rupture s'il est disponible, de réapprovisionnement
 * s'il est en rupture — dans l'ordre de la liste des favorites (la plus
 * récemment ajoutée d'abord).
 *
 * Quatre lectures indépendantes (favorites, stations, deux prévisions) assemblées
 * ici : chacune tient en quelques documents, une jointure `$lookup` n'y
 * gagnerait rien et lierait deux collections écrites par le pipeline à une
 * collection écrite par le backend.
 */
@Injectable()
export class ListFavoriteStationDetailsQuery {
  constructor(
    private readonly favorites: FavoriteStationRepository,
    private readonly stations: FuelStationReadModel,
    private readonly forecasts: ShortageForecastReadModel,
    private readonly restockForecasts: RestockForecastReadModel,
  ) {}

  async execute(owner: UserId, now: Date = new Date()): Promise<FavoriteStationDetailsResult> {
    const entries = await this.favorites.list(owner);
    const ids = entries.map((entry) => entry.stationId);
    const [stations, forecasts, restocks] = await Promise.all([
      this.stations.findByIds(ids),
      this.forecasts.findForStations(ids),
      this.restockForecasts.findForStations(ids),
    ]);

    const stationById = new Map(stations.map((station) => [station.id, station]));
    const forecastByPair = new Map<string, PublishedForecast>(
      forecasts.map((f) => [pairKey(f.stationId, f.fuel), f]),
    );
    const restockByPair = new Map<string, PublishedRestockForecast>(
      restocks.map((f) => [pairKey(f.stationId, f.fuel), f]),
    );

    let latest: Date | null = null;
    let latestRestock: Date | null = null;
    const views = entries.map((entry): FavoriteStationDetailsView => {
      const station = stationById.get(entry.stationId);
      if (station === undefined) {
        return { id: entry.stationId, addedAt: entry.addedAt.toISOString(), station: null };
      }
      const { id, fuels, ...rest } = station;
      return {
        id,
        addedAt: entry.addedAt.toISOString(),
        station: {
          ...rest,
          fuels: fuels.map((fuel) => {
            const outlook = shortageOutlook(
              forecastByPair.get(pairKey(id, fuel.code)) ?? null,
              fuel.available,
              now,
            );
            if (outlook && (latest === null || outlook.computedAt > latest)) latest = outlook.computedAt;
            const restock = restockOutlook(
              restockByPair.get(pairKey(id, fuel.code)) ?? null,
              fuel.available,
              fuel.shortageSince,
              now,
            );
            if (restock && (latestRestock === null || restock.computedAt > latestRestock)) {
              latestRestock = restock.computedAt;
            }
            return {
              ...toFuelView(fuel, now),
              shortageOutlook: outlook && {
                risk: outlook.risk,
                level: outlook.level,
                computedAt: outlook.computedAt.toISOString(),
                horizonEnd: outlook.horizonEnd.toISOString(),
              },
              restockOutlook: restock && {
                probability: restock.probability,
                level: restock.level,
                computedAt: restock.computedAt.toISOString(),
                horizonEnd: restock.horizonEnd.toISOString(),
              },
            };
          }),
        },
      };
    });

    return {
      stations: views,
      staleAfterHours: STALE_AFTER_HOURS,
      forecast: {
        horizonHours: FORECAST_HORIZON_HOURS,
        maxAgeHours: FORECAST_MAX_AGE_HOURS,
        elevatedThreshold: ELEVATED_SHORTAGE_THRESHOLD,
        likelyThreshold: LIKELY_SHORTAGE_THRESHOLD,
        computedAt: (latest as Date | null)?.toISOString() ?? null,
      },
      restockForecast: {
        horizonHours: FORECAST_HORIZON_HOURS,
        maxAgeHours: FORECAST_MAX_AGE_HOURS,
        possibleThreshold: POSSIBLE_RESTOCK_THRESHOLD,
        likelyThreshold: LIKELY_RESTOCK_THRESHOLD,
        computedAt: (latestRestock as Date | null)?.toISOString() ?? null,
      },
    };
  }
}

function pairKey(stationId: string, fuel: string): string {
  return `${stationId}:${fuel}`;
}

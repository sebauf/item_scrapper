import { Injectable } from '@nestjs/common';
import { UserId } from 'src/shared/domain/user-id';
import { FavoriteStationRepository } from '../../domain/favorite-station.repository';
import { STALE_AFTER_HOURS } from '../../domain/freshness-policy';
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
import { ShortageForecastReadModel } from '../ports/shortage-forecast.read-model';
import { FuelPriceView, toFuelView } from './search-fuel-stations.query';

export interface ShortageOutlookView {
  risk: number;
  level: ShortageRiskLevel;
  computedAt: string;
  horizonEnd: string;
}

export interface FavoriteFuelView extends FuelPriceView {
  /** null : pas de prévision (cf. `shortageOutlook`). */
  shortageOutlook: ShortageOutlookView | null;
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
}

/**
 * Les stations favorites de `owner` avec leurs prix et, pour chaque carburant
 * disponible, la prévision de rupture à 24 h — dans l'ordre de la liste des
 * favorites (la plus récemment ajoutée d'abord).
 *
 * Trois lectures indépendantes (favorites, stations, prévisions) assemblées
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
  ) {}

  async execute(owner: UserId, now: Date = new Date()): Promise<FavoriteStationDetailsResult> {
    const entries = await this.favorites.list(owner);
    const ids = entries.map((entry) => entry.stationId);
    const [stations, forecasts] = await Promise.all([
      this.stations.findByIds(ids),
      this.forecasts.findForStations(ids),
    ]);

    const stationById = new Map(stations.map((station) => [station.id, station]));
    const forecastByPair = new Map<string, PublishedForecast>(
      forecasts.map((f) => [pairKey(f.stationId, f.fuel), f]),
    );

    let latest: Date | null = null;
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
            return {
              ...toFuelView(fuel, now),
              shortageOutlook: outlook && {
                risk: outlook.risk,
                level: outlook.level,
                computedAt: outlook.computedAt.toISOString(),
                horizonEnd: outlook.horizonEnd.toISOString(),
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
    };
  }
}

function pairKey(stationId: string, fuel: string): string {
  return `${stationId}:${fuel}`;
}

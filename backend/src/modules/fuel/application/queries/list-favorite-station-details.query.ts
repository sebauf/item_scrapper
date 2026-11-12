import { Injectable } from '@nestjs/common';
import { UserId } from 'src/shared/domain/user-id';
import {
  FavoriteStationEntry,
  FavoriteStationRepository,
} from '../../domain/favorite-station.repository';
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
import { FuelPriceRow, FuelStationReadModel, StationRow } from '../ports/fuel-station.read-model';
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
    const [stations, shortageForecasts, restockForecasts] = await Promise.all([
      this.stations.findByIds(ids),
      this.forecasts.findForStations(ids),
      this.restockForecasts.findForStations(ids),
    ]);

    const stationById = new Map(stations.map((station) => [station.id, station]));
    const forecasts: ForecastsByPair = {
      shortage: byPair(shortageForecasts),
      restock: byPair(restockForecasts),
    };
    const views = entries.map((entry) =>
      favoriteStationView(entry, stationById.get(entry.stationId) ?? null, forecasts, now),
    );

    return {
      stations: views,
      staleAfterHours: STALE_AFTER_HOURS,
      forecast: {
        horizonHours: FORECAST_HORIZON_HOURS,
        maxAgeHours: FORECAST_MAX_AGE_HOURS,
        elevatedThreshold: ELEVATED_SHORTAGE_THRESHOLD,
        likelyThreshold: LIKELY_SHORTAGE_THRESHOLD,
        computedAt: latestComputedAt(views, (fuel) => fuel.shortageOutlook),
      },
      restockForecast: {
        horizonHours: FORECAST_HORIZON_HOURS,
        maxAgeHours: FORECAST_MAX_AGE_HOURS,
        possibleThreshold: POSSIBLE_RESTOCK_THRESHOLD,
        likelyThreshold: LIKELY_RESTOCK_THRESHOLD,
        computedAt: latestComputedAt(views, (fuel) => fuel.restockOutlook),
      },
    };
  }
}

interface ForecastsByPair {
  shortage: Map<string, PublishedForecast>;
  restock: Map<string, PublishedRestockForecast>;
}

function byPair<F extends { stationId: string; fuel: string }>(forecasts: F[]): Map<string, F> {
  return new Map(forecasts.map((forecast) => [pairKey(forecast.stationId, forecast.fuel), forecast]));
}

function pairKey(stationId: string, fuel: string): string {
  return `${stationId}:${fuel}`;
}

function favoriteStationView(
  entry: FavoriteStationEntry,
  station: StationRow | null,
  forecasts: ForecastsByPair,
  now: Date,
): FavoriteStationDetailsView {
  const addedAt = entry.addedAt.toISOString();
  if (station === null) return { id: entry.stationId, addedAt, station: null };
  const { id, fuels, ...rest } = station;
  return {
    id,
    addedAt,
    station: { ...rest, fuels: fuels.map((fuel) => favoriteFuelView(id, fuel, forecasts, now)) },
  };
}

/** Prévision de rupture si le carburant est disponible, de retour s'il est en rupture. */
function favoriteFuelView(
  stationId: string,
  fuel: FuelPriceRow,
  forecasts: ForecastsByPair,
  now: Date,
): FavoriteFuelView {
  const key = pairKey(stationId, fuel.code);
  const shortage = shortageOutlook(forecasts.shortage.get(key) ?? null, fuel.available, now);
  const restock = restockOutlook(
    forecasts.restock.get(key) ?? null,
    fuel.available,
    fuel.shortageSince,
    now,
  );
  return {
    ...toFuelView(fuel, now),
    shortageOutlook: shortage && { risk: shortage.risk, level: shortage.level, ...horizonDates(shortage) },
    restockOutlook: restock && {
      probability: restock.probability,
      level: restock.level,
      ...horizonDates(restock),
    },
  };
}

function horizonDates(outlook: { computedAt: Date; horizonEnd: Date }) {
  return { computedAt: outlook.computedAt.toISOString(), horizonEnd: outlook.horizonEnd.toISOString() };
}

/**
 * Date de la prévision la plus récente affichée, `null` s'il n'y en a aucune.
 * Les dates ISO 8601 en UTC se comparent comme des chaînes.
 */
function latestComputedAt(
  views: FavoriteStationDetailsView[],
  outlookOf: (fuel: FavoriteFuelView) => { computedAt: string } | null,
): string | null {
  const dates = views
    .flatMap((view) => view.station?.fuels ?? [])
    .map((fuel) => outlookOf(fuel)?.computedAt)
    .filter((date): date is string => date !== undefined);
  return dates.length === 0 ? null : dates.reduce((a, b) => (b > a ? b : a));
}

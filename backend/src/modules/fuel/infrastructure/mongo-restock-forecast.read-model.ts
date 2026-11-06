import { Inject, Injectable } from '@nestjs/common';
import { Db } from 'mongodb';
import { MONGO_DB } from 'src/shared/infrastructure/mongo/mongo.tokens';
import {
  RestockForecastReadModel,
  RestockForecastRow,
} from '../application/ports/restock-forecast.read-model';
import { FuelType, isFuelType } from '../domain/fuel-type';

/** Forme écrite par pipeline/src/fuel/restock_forecast/forecasts.py. */
interface RestockForecastDocument {
  _id: string;
  stationId: string;
  fuel: string;
  probability: number;
  computedAt: Date;
  horizonHours?: number;
}

/**
 * Pas d'index dédié, pour la même raison que les prévisions de rupture : la
 * collection ne contient que les ruptures en cours des stations favorites.
 */
@Injectable()
export class MongoRestockForecastReadModel extends RestockForecastReadModel {
  constructor(@Inject(MONGO_DB) private readonly db: Db) {
    super();
  }

  async findForStations(stationIds: string[]): Promise<RestockForecastRow[]> {
    if (stationIds.length === 0) return [];
    const docs = await this.db
      .collection<RestockForecastDocument>('fuel_restock_forecasts')
      .find({ stationId: { $in: stationIds } })
      .toArray();
    // Un document d'une autre version du pipeline est ignoré, pas fatal.
    return docs
      .filter(
        (doc) =>
          isFuelType(doc.fuel) &&
          typeof doc.probability === 'number' &&
          doc.probability >= 0 &&
          doc.probability <= 1 &&
          doc.computedAt instanceof Date,
      )
      .map((doc) => ({
        stationId: doc.stationId,
        fuel: doc.fuel as FuelType,
        probability: doc.probability,
        computedAt: doc.computedAt,
      }));
  }
}

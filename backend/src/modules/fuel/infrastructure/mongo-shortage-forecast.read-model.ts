import { Inject, Injectable } from '@nestjs/common';
import { Db } from 'mongodb';
import { MONGO_DB } from 'src/shared/infrastructure/mongo/mongo.tokens';
import {
  ShortageForecastReadModel,
  ShortageForecastRow,
} from '../application/ports/shortage-forecast.read-model';
import { FuelType, isFuelType } from '../domain/fuel-type';

/** Forme écrite par pipeline/src/fuel/shortage_forecast/forecasts.py. */
interface ShortageForecastDocument {
  _id: string;
  stationId: string;
  fuel: string;
  risk: number;
  computedAt: Date;
  horizonHours?: number;
}

/**
 * Pas d'index dédié : la collection ne contient que les stations favorites
 * (une poignée par utilisateur, six carburants au plus chacune), le parcours
 * complet coûte moins qu'un index à entretenir.
 */
@Injectable()
export class MongoShortageForecastReadModel extends ShortageForecastReadModel {
  constructor(@Inject(MONGO_DB) private readonly db: Db) {
    super();
  }

  async findForStations(stationIds: string[]): Promise<ShortageForecastRow[]> {
    if (stationIds.length === 0) return [];
    const docs = await this.db
      .collection<ShortageForecastDocument>('fuel_shortage_forecasts')
      .find({ stationId: { $in: stationIds } })
      .toArray();
    // Un document écrit par une autre version du pipeline ne doit pas faire
    // tomber la page : il est ignoré.
    return docs
      .filter(
        (doc) =>
          isFuelType(doc.fuel) &&
          typeof doc.risk === 'number' &&
          doc.risk >= 0 &&
          doc.risk <= 1 &&
          doc.computedAt instanceof Date,
      )
      .map((doc) => ({
        stationId: doc.stationId,
        fuel: doc.fuel as FuelType,
        risk: doc.risk,
        computedAt: doc.computedAt,
      }));
  }
}

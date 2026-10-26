import { Inject, Injectable } from '@nestjs/common';
import { Db } from 'mongodb';
import { MONGO_DB } from 'src/shared/infrastructure/mongo/mongo.tokens';
import { MAX_STATIONS, StationSearch } from '../domain/station-search';
import {
  FuelStationReadModel,
  FuelStationRow,
  NearbyStations,
} from '../application/ports/fuel-station.read-model';
import { nearStationsPipeline } from './fuel-station.stages';

/** Forme écrite par pipeline/src/fuel/import_stations.py. */
export interface FuelStationDocument {
  _id: string;
  location: { type: 'Point'; coordinates: [number, number] };
  brand?: string | null;
  name?: string | null;
  address?: string;
  city?: string;
  postcode?: string;
  roadType?: 'R' | 'A' | null;
  fuels?: FuelStationRow['fuels'];
  importedAt?: Date;
  /** Ajouté par `$geoNear`. */
  distanceMeters?: number;
}

export function toStationRow(doc: FuelStationDocument): FuelStationRow {
  const [longitude, latitude] = doc.location.coordinates;
  return {
    id: doc._id,
    brand: doc.brand ?? null,
    name: doc.name ?? null,
    address: doc.address ?? '',
    city: doc.city ?? '',
    postcode: doc.postcode ?? '',
    roadType: doc.roadType ?? null,
    latitude,
    longitude,
    // Au mètre près : au-delà, c'est du bruit pour un trajet en voiture.
    distanceKm: Math.round(doc.distanceMeters ?? 0) / 1000,
    fuels: (doc.fuels ?? []).map((fuel) => ({
      code: fuel.code,
      price: fuel.price ?? null,
      updatedAt: fuel.updatedAt ?? null,
      available: fuel.available ?? false,
      shortageSince: fuel.shortageSince ?? null,
    })),
  };
}

@Injectable()
export class MongoFuelStationReadModel extends FuelStationReadModel {
  constructor(@Inject(MONGO_DB) private readonly db: Db) {
    super();
  }

  async findNear(search: StationSearch): Promise<NearbyStations> {
    const collection = this.db.collection<FuelStationDocument>('fuel_stations');

    const [docs, latest] = await Promise.all([
      collection.aggregate<FuelStationDocument>(nearStationsPipeline(search)).toArray(),
      collection.findOne({}, { sort: { importedAt: -1 }, projection: { importedAt: 1 } }),
    ]);

    return {
      stations: docs.slice(0, MAX_STATIONS).map(toStationRow),
      truncated: docs.length > MAX_STATIONS,
      lastImportAt: latest?.importedAt ?? null,
    };
  }

  async exists(stationId: string): Promise<boolean> {
    const doc = await this.db
      .collection<FuelStationDocument>('fuel_stations')
      .findOne({ _id: stationId }, { projection: { _id: 1 } });
    return doc !== null;
  }
}

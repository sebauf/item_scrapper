import { Injectable } from '@nestjs/common';
import { FavoriteStationRepository } from '../../domain/favorite-station.repository';

export interface FavoriteStationView {
  id: string;
  addedAt: string;
}

@Injectable()
export class ListFavoriteStationsQuery {
  constructor(private readonly favorites: FavoriteStationRepository) {}

  async execute(): Promise<FavoriteStationView[]> {
    const entries = await this.favorites.list();
    return entries.map((entry) => ({ id: entry.stationId, addedAt: entry.addedAt.toISOString() }));
  }
}

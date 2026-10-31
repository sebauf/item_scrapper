import { Injectable } from '@nestjs/common';
import { UserId } from 'src/shared/domain/user-id';
import { FavoriteStationRepository } from '../../domain/favorite-station.repository';

export interface FavoriteStationView {
  id: string;
  addedAt: string;
}

@Injectable()
export class ListFavoriteStationsQuery {
  constructor(private readonly favorites: FavoriteStationRepository) {}

  async execute(owner: UserId): Promise<FavoriteStationView[]> {
    const entries = await this.favorites.list(owner);
    return entries.map((entry) => ({ id: entry.stationId, addedAt: entry.addedAt.toISOString() }));
  }
}

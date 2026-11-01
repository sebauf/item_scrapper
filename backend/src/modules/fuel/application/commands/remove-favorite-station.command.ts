import { Injectable } from '@nestjs/common';
import { UserId } from 'src/shared/domain/user-id';
import { FavoriteStationRepository } from '../../domain/favorite-station.repository';
import { StationId } from '../../domain/station-id';

/**
 * Retire une station des favorites. Idempotent, et sans vérifier l'existence
 * de la station : retirer une favorite dont la station a quitté le flux doit
 * rester possible.
 */
@Injectable()
export class RemoveFavoriteStationCommand {
  constructor(private readonly favorites: FavoriteStationRepository) {}

  async execute(owner: UserId, rawId: unknown): Promise<void> {
    const stationId = StationId.create(rawId);
    await this.favorites.remove(owner, stationId.value);
  }
}

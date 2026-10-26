import { Injectable } from '@nestjs/common';
import { FavoriteStationRepository } from '../../domain/favorite-station.repository';
import { FuelStationNotFound } from '../../domain/fuel.errors';
import { StationId } from '../../domain/station-id';
import { FuelStationReadModel } from '../ports/fuel-station.read-model';

/**
 * Met une station en favori. Idempotent : refavoriser n'est pas une erreur.
 *
 * La station doit exister dans le dernier import — un identifiant tapé de
 * travers ne doit pas devenir une favorite fantôme, surveillée pour rien.
 * L'inverse n'est pas vérifié : une favorite dont la station quitte ensuite
 * le flux reste en place, et redevient utile si la station y revient.
 */
@Injectable()
export class AddFavoriteStationCommand {
  constructor(
    private readonly favorites: FavoriteStationRepository,
    private readonly stations: FuelStationReadModel,
  ) {}

  async execute(rawId: unknown): Promise<void> {
    const stationId = StationId.create(rawId);
    if (!(await this.stations.exists(stationId.value))) {
      throw new FuelStationNotFound(`Station ${stationId.value} introuvable dans le flux officiel.`);
    }
    await this.favorites.add(stationId.value);
  }
}

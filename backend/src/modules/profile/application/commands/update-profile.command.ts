import { Injectable } from '@nestjs/common';
import { UserId } from 'src/shared/domain/user-id';
import { FavoriteStationRepository } from '../../../fuel/domain/favorite-station.repository';
import { UserProfile } from '../../domain/user-profile';
import { UserProfileRepository } from '../../domain/user-profile.repository';
import { ProfileView, toView } from '../queries/get-profile.query';

/**
 * Remplace le profil de l'utilisateur (numéro + carburants surveillés) et
 * renvoie le profil enregistré, numéro normalisé — le formulaire affiche
 * ainsi `+33612345678` là où l'utilisateur a tapé `06 12 34 56 78`.
 */
@Injectable()
export class UpdateProfileCommand {
  constructor(
    private readonly profiles: UserProfileRepository,
    private readonly favoriteStations: FavoriteStationRepository,
  ) {}

  async execute(owner: UserId, input: { phone: unknown; alertFuels: unknown }): Promise<ProfileView> {
    const profile = UserProfile.create(input);
    await this.profiles.save(owner, profile);
    return toView(owner, profile, this.favoriteStations);
  }
}

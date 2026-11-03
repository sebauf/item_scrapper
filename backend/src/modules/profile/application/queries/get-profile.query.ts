import { Injectable } from '@nestjs/common';
import { UserId } from 'src/shared/domain/user-id';
import { FavoriteStationRepository } from '../../../fuel/domain/favorite-station.repository';
import { FuelType } from '../../../fuel/domain/fuel-type';
import { FuelAlertRequirement, UserProfile } from '../../domain/user-profile';
import { UserProfileRepository } from '../../domain/user-profile.repository';

export interface ProfileView {
  email: string;
  phone: string | null;
  alertFuels: FuelType[];
  favoriteStationCount: number;
  fuelAlerts: { active: boolean; missing: FuelAlertRequirement[] };
}

/**
 * Profil de l'utilisateur, avec l'état de ses alertes carburant.
 *
 * Les stations surveillées sont ses stations favorites (contexte Fuel) : le
 * profil n'en garde pas de copie, il les compte pour dire si l'alerte est
 * active.
 */
@Injectable()
export class GetProfileQuery {
  constructor(
    private readonly profiles: UserProfileRepository,
    private readonly favoriteStations: FavoriteStationRepository,
  ) {}

  async execute(owner: UserId): Promise<ProfileView> {
    return toView(owner, await this.profiles.find(owner), this.favoriteStations);
  }
}

export async function toView(
  owner: UserId,
  profile: UserProfile,
  favoriteStations: FavoriteStationRepository,
): Promise<ProfileView> {
  const favoriteStationCount = (await favoriteStations.list(owner)).length;
  const missing = profile.missingForFuelAlerts(favoriteStationCount);
  return {
    email: owner.value,
    phone: profile.phone?.value ?? null,
    alertFuels: [...profile.alertFuels],
    favoriteStationCount,
    fuelAlerts: { active: missing.length === 0, missing },
  };
}

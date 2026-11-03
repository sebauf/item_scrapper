import { UserId } from 'src/shared/domain/user-id';
import { UserProfile } from './user-profile';

/**
 * Port de persistance des profils (`user_profiles`, un document par
 * utilisateur). La collection est aussi lue par le pipeline : c'est elle qui
 * dit à qui, et pour quels carburants, part l'alerte de réapprovisionnement.
 */
export abstract class UserProfileRepository {
  /** Profil de `owner`, vide s'il n'en a jamais enregistré. */
  abstract find(owner: UserId): Promise<UserProfile>;

  abstract save(owner: UserId, profile: UserProfile): Promise<void>;
}

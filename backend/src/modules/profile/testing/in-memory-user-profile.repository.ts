import { UserId } from 'src/shared/domain/user-id';
import { UserProfile } from '../domain/user-profile';
import { UserProfileRepository } from '../domain/user-profile.repository';

export class InMemoryUserProfileRepository extends UserProfileRepository {
  readonly store = new Map<string, UserProfile>();

  find(owner: UserId): Promise<UserProfile> {
    return Promise.resolve(this.store.get(owner.value) ?? UserProfile.empty());
  }

  save(owner: UserId, profile: UserProfile): Promise<void> {
    this.store.set(owner.value, profile);
    return Promise.resolve();
  }
}

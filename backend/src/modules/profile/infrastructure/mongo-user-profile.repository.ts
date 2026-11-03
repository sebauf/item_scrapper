import { Inject, Injectable } from '@nestjs/common';
import { Collection, Db } from 'mongodb';
import { UserId } from 'src/shared/domain/user-id';
import { MONGO_DB } from 'src/shared/infrastructure/mongo/mongo.tokens';
import { UserProfile } from '../domain/user-profile';
import { UserProfileRepository } from '../domain/user-profile.repository';

/**
 * `_id` = identifiant de l'utilisateur (e-mail) : un profil par compte, sans
 * index supplémentaire. Le pipeline lit `phone` et `alertFuels`
 * (pipeline/src/fuel/restock_alerts.py) — ne pas les renommer sans lui.
 */
interface UserProfileDocument {
  _id: string;
  phone: string | null;
  alertFuels: string[];
  updatedAt: Date;
}

@Injectable()
export class MongoUserProfileRepository extends UserProfileRepository {
  constructor(@Inject(MONGO_DB) private readonly db: Db) {
    super();
  }

  private get collection(): Collection<UserProfileDocument> {
    return this.db.collection<UserProfileDocument>('user_profiles');
  }

  async find(owner: UserId): Promise<UserProfile> {
    const doc = await this.collection.findOne({ _id: owner.value });
    return doc ? UserProfile.restore(doc) : UserProfile.empty();
  }

  async save(owner: UserId, profile: UserProfile): Promise<void> {
    await this.collection.replaceOne(
      { _id: owner.value },
      {
        phone: profile.phone?.value ?? null,
        alertFuels: [...profile.alertFuels],
        updatedAt: new Date(),
      },
      { upsert: true },
    );
  }
}

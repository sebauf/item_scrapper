import { Inject, Injectable } from '@nestjs/common';
import { Collection, Db } from 'mongodb';
import { UserId } from 'src/shared/domain/user-id';
import { MONGO_DB } from 'src/shared/infrastructure/mongo/mongo.tokens';
import { subscriptionUpdate } from 'src/shared/infrastructure/mongo/subscriptions';
import { Keyword } from '../domain/keyword';
import { KeywordName } from '../domain/keyword-name';
import { KeywordRepository } from '../domain/keyword.repository';

/**
 * Forme du document. `keyword` (unique) et `enabled` sont lus par le scrapper
 * (scrapper/src/infrastructure/persistence/mongodb/MongoKeywordRepository.ts) ;
 * `subscribers` n'est lu que par le backend.
 */
export interface KeywordDocument {
  keyword: string;
  enabled?: boolean;
  /** Adresses des utilisateurs qui suivent ce mot-clé. Absent sur les documents historiques. */
  subscribers?: string[];
}

@Injectable()
export class MongoKeywordRepository extends KeywordRepository {
  constructor(@Inject(MONGO_DB) private readonly db: Db) {
    super();
  }

  private get collection(): Collection<KeywordDocument> {
    return this.db.collection<KeywordDocument>('keywords');
  }

  async findByName(owner: UserId, name: KeywordName): Promise<Keyword | null> {
    const doc = await this.collection.findOne(
      { keyword: name.value },
      { projection: { subscribers: 1 } },
    );
    if (doc === null) return null;

    return Keyword.rehydrate(owner, name, (doc.subscribers ?? []).includes(owner.value));
  }

  /** Servi par l'index multikey `keywords.subscribers`. */
  countTrackedBy(owner: UserId): Promise<number> {
    return this.collection.countDocuments({ subscribers: owner.value });
  }

  /**
   * Upsert : le premier abonné crée le document, que le scrapper relèvera dès
   * son prochain passage. Le dernier désabonnement le passe à `enabled: false`
   * sans le supprimer (cf. l'agrégat `Keyword`).
   */
  async save(keyword: Keyword): Promise<void> {
    await this.collection.updateOne(
      { keyword: keyword.name.value },
      subscriptionUpdate(keyword.owner.value, keyword.isTracked),
      { upsert: true },
    );
  }
}

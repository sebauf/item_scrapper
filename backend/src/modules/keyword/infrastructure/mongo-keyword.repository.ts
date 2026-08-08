import { Inject, Injectable } from '@nestjs/common';
import { Collection, Db } from 'mongodb';
import { MONGO_DB } from 'src/shared/infrastructure/mongo/mongo.tokens';
import { Keyword } from '../domain/keyword';
import { KeywordName } from '../domain/keyword-name';
import { KeywordRepository } from '../domain/keyword.repository';

/** Forme du document tel qu'écrit historiquement par le scrapper. */
interface KeywordDocument {
  keyword: string;
  enabled?: boolean;
}

@Injectable()
export class MongoKeywordRepository extends KeywordRepository {
  constructor(@Inject(MONGO_DB) private readonly db: Db) {
    super();
  }

  private get collection(): Collection<KeywordDocument> {
    return this.db.collection<KeywordDocument>('keywords');
  }

  async findByName(name: KeywordName): Promise<Keyword | null> {
    const doc = await this.collection.findOne({ keyword: name.value });
    if (doc === null) return null;

    // Les documents seedés avant l'ajout du champ `enabled` sont considérés
    // comme suivis — c'est le comportement du scrapper depuis l'origine.
    return Keyword.rehydrate(KeywordName.create(doc.keyword), doc.enabled !== false);
  }

  async save(keyword: Keyword): Promise<void> {
    await this.collection.updateOne(
      { keyword: keyword.name.value },
      { $set: { enabled: keyword.isTracked } },
      { upsert: true },
    );
  }
}

import {
  Global,
  Inject,
  Logger,
  Module,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Db, MongoClient } from 'mongodb';
import { AppConfig } from 'src/config/app-config';
import { ensureIndexes } from './indexes';
import { claimLegacyData, countLegacyData, describe, totalOf } from './legacy-ownership';
import { MONGO_CLIENT, MONGO_DB } from './mongo.tokens';

/**
 * Connexion MongoDB partagée par tout le backend.
 *
 * @Global évite d'avoir à réimporter ce module dans chaque contexte : `Db` est
 * une ressource d'infrastructure, pas une dépendance métier.
 *
 * La connexion est établie *pendant* la résolution du provider, donc avant que
 * le serveur HTTP n'écoute : si Mongo est injoignable, le pod ne démarre pas et
 * Kubernetes le signale, plutôt que de servir des 500.
 */
@Global()
@Module({
  providers: [
    {
      provide: MONGO_CLIENT,
      inject: [AppConfig],
      useFactory: async (config: AppConfig): Promise<MongoClient> => {
        const client = new MongoClient(config.mongodbUri);
        await client.connect();
        return client;
      },
    },
    {
      provide: MONGO_DB,
      inject: [MONGO_CLIENT, AppConfig],
      useFactory: (client: MongoClient, config: AppConfig): Db =>
        client.db(config.mongodbDatabase),
    },
  ],
  exports: [MONGO_CLIENT, MONGO_DB],
})
export class MongoModule implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MongoModule.name);

  constructor(
    @Inject(MONGO_DB) private readonly db: Db,
    @Inject(MONGO_CLIENT) private readonly client: MongoClient,
    private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Avant les index : le rattachement renseigne `userId`, sur lequel portent
    // les nouveaux index uniques (partiels, donc sans risque, mais autant créer
    // l'index sur des données déjà dans leur forme finale).
    await this.adoptLegacyData();

    const created = await ensureIndexes(this.db);
    this.logger.log(
      created.length > 0
        ? `Index créés : ${created.join(', ')}`
        : 'Index déjà en place, rien à créer.',
    );
  }

  /** Cf. legacy-ownership.ts. */
  private async adoptLegacyData(): Promise<void> {
    const owner = this.config.legacyOwnerEmail;
    if (owner !== null) {
      const claimed = await claimLegacyData(this.db, owner);
      if (totalOf(claimed) > 0) {
        this.logger.log(`Données historiques rattachées à ${owner.value} : ${describe(claimed)}.`);
      }
      return;
    }

    const orphans = await countLegacyData(this.db);
    if (totalOf(orphans) > 0) {
      this.logger.warn(
        `Données sans propriétaire, invisibles pour tous : ${describe(orphans)}. ` +
          'Renseigner AUTH_LEGACY_OWNER_EMAIL pour les rattacher à un compte.',
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.close();
  }
}

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
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const created = await ensureIndexes(this.db);
    this.logger.log(
      created.length > 0
        ? `Index créés : ${created.join(', ')}`
        : 'Index déjà en place, rien à créer.',
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.close();
  }
}

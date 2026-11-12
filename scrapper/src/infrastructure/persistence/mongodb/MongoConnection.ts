import { MongoClient, type Db } from 'mongodb';

/** Nom de base unique du projet, en dur aussi dans le pipeline et le backend. */
export const DB_NAME = 'scrapper';

export class MongoConnection {
  private client: MongoClient | null = null;
  private _db: Db | null = null;

  /** Connexion à `MONGODB_URI` : pour les points d'entrée (`main.ts`, scripts). */
  static async fromEnv(env: NodeJS.ProcessEnv = process.env): Promise<MongoConnection> {
    const uri = env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is not defined');
    const connection = new MongoConnection();
    await connection.connect(uri);
    return connection;
  }

  /** Se connecte et crée les index uniques dont dépendent les upserts du scrapper. */
  async connect(uri: string): Promise<void> {
    this.client = new MongoClient(uri);
    await this.client.connect();
    this._db = this.client.db(DB_NAME);
    await this._db.collection('items_raw').createIndex({ url: 1, day: 1 }, { unique: true });
    await this._db.collection('keywords').createIndex({ keyword: 1 }, { unique: true });
    await this._db.collection('tracked_urls').createIndex({ url: 1 }, { unique: true });
  }

  get db(): Db {
    if (!this._db) throw new Error('MongoDB not connected');
    return this._db;
  }

  async disconnect(): Promise<void> {
    await this.client?.close();
  }
}

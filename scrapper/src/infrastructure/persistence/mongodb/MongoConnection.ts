import { MongoClient, type Db } from 'mongodb';

export class MongoConnection {
  private client: MongoClient | null = null;
  private _db: Db | null = null;

  async connect(uri: string): Promise<void> {
    this.client = new MongoClient(uri);
    await this.client.connect();
    this._db = this.client.db('scrapper');
    await this._db.collection('items_raw').createIndex({ url: 1, day: 1 }, { unique: true });
    await this._db.collection('keywords').createIndex({ keyword: 1 }, { unique: true });
  }

  get db(): Db {
    if (!this._db) throw new Error('MongoDB not connected');
    return this._db;
  }

  async disconnect(): Promise<void> {
    await this.client?.close();
  }
}

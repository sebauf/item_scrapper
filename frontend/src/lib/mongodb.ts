import { MongoClient, type Db } from 'mongodb';

declare global {
  // eslint-disable-next-line no-var
  var _mongoClient: MongoClient | undefined;
}

function getClient(): MongoClient {
  if (process.env.NODE_ENV === 'development') {
    if (!global._mongoClient) {
      global._mongoClient = new MongoClient(process.env.MONGODB_URI!);
    }
    return global._mongoClient;
  }
  return new MongoClient(process.env.MONGODB_URI!);
}

let client: MongoClient | undefined;

export async function getDb(): Promise<Db> {
  client ??= getClient();
  await client.connect();
  return client.db('scrapper');
}

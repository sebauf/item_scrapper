import 'dotenv/config';
import { MongoConnection } from '../infrastructure/persistence/mongodb/MongoConnection.js';
import { CURRENCY_SYMBOL_TO_ISO } from '../infrastructure/scraping/amazon/PriceParser.js';
import { toHighResImageUrls } from '../infrastructure/scraping/amazon/ImageUrlParser.js';

interface LegacyDoc {
  _id: unknown;
  price?: { amount: number; currency: string } | null;
  crossedOutPrice?: { amount: number; currency: string } | null;
  images?: string[];
}

async function main(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGODB_URI is not defined');

  const connection = new MongoConnection();
  await connection.connect(mongoUri);

  try {
    const collection = connection.db.collection<LegacyDoc>('items_raw');
    const cursor = collection.find({});
    let updated = 0;

    for await (const doc of cursor) {
      const set: Record<string, unknown> = {};

      const legacyPriceCurrency = doc.price?.currency;
      if (legacyPriceCurrency && CURRENCY_SYMBOL_TO_ISO[legacyPriceCurrency]) {
        set['price.currency'] = CURRENCY_SYMBOL_TO_ISO[legacyPriceCurrency];
      }

      const legacyCrossedOutCurrency = doc.crossedOutPrice?.currency;
      if (legacyCrossedOutCurrency && CURRENCY_SYMBOL_TO_ISO[legacyCrossedOutCurrency]) {
        set['crossedOutPrice.currency'] = CURRENCY_SYMBOL_TO_ISO[legacyCrossedOutCurrency];
      }

      if (doc.images?.length) {
        const highRes = toHighResImageUrls(doc.images);
        if (JSON.stringify(highRes) !== JSON.stringify(doc.images)) {
          set.images = highRes;
        }
      }

      if (Object.keys(set).length > 0) {
        await collection.updateOne({ _id: doc._id }, { $set: set });
        updated++;
      }
    }

    console.log(`Migrated ${updated} document(s).`);
  } finally {
    await connection.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

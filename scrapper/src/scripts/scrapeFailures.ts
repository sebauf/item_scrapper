import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { Binary, ObjectId } from 'mongodb';
import { MongoConnection } from '../infrastructure/persistence/mongodb/MongoConnection.js';
import { COLLECTION_SCRAPE_FAILURES } from '../infrastructure/persistence/mongodb/MongoScrapeFailureRepository.js';

/**
 * Lecture des échecs de pages enregistrés par le scrapper (`scrape_failures`).
 * N'écrit rien en base.
 *
 * Usage :
 *   npm run failures                      # bilan du dernier jour en échec + derniers échecs
 *   npm run failures -- --day=2026-11-10  # bilan d'un jour donné (UTC)
 *   npm run failures -- --dump=<id>       # écrit le HTML conservé dans scrape-failure-<id>.html
 *   node dist/scripts/scrapeFailures.js   # dans l'image
 */

const RECENT_LIMIT = 15;

type FailureDoc = {
  _id: ObjectId;
  url: string;
  pageKind: string;
  reason: string;
  outcome: string;
  attempt: number;
  detail: string;
  httpStatus: number | null;
  occurredAt: Date;
  day: Date;
  html?: Binary;
};

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null;
}

async function main(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGODB_URI is not defined');

  const connection = new MongoConnection();
  await connection.connect(mongoUri);
  try {
    const collection = connection.db.collection<FailureDoc>(COLLECTION_SCRAPE_FAILURES);

    const dumpId = argValue('dump');
    if (dumpId) {
      const doc = await collection.findOne({ _id: new ObjectId(dumpId) });
      if (!doc) throw new Error(`Aucun échec ${dumpId}`);
      if (!doc.html) throw new Error(`L'échec ${dumpId} (${doc.reason}) n'a pas de HTML conservé`);
      const file = `scrape-failure-${dumpId}.html`;
      writeFileSync(file, gunzipSync(doc.html.buffer));
      console.log(`${file} — ${doc.reason} : ${doc.detail}\n${doc.url}`);
      return;
    }

    const dayArg = argValue('day');
    const day = dayArg
      ? new Date(`${dayArg}T00:00:00Z`)
      : (await collection.find().sort({ day: -1 }).limit(1).next())?.day;
    if (!day) {
      console.log('Aucun échec enregistré.');
      return;
    }

    const rows = await collection
      .aggregate<{ _id: { reason: string; pageKind: string; outcome: string }; n: number }>([
        { $match: { day } },
        { $group: { _id: { reason: '$reason', pageKind: '$pageKind', outcome: '$outcome' }, n: { $sum: 1 } } },
        { $sort: { n: -1 } },
      ])
      .toArray();
    console.log(`Échecs du ${day.toISOString().slice(0, 10)} (UTC) :`);
    for (const { _id, n } of rows) {
      console.log(`  ${String(n).padStart(5)}  ${_id.reason.padEnd(15)} ${_id.pageKind.padEnd(8)} ${_id.outcome}`);
    }

    const recent = await collection
      .find({ day }, { projection: { html: 0 } })
      .sort({ occurredAt: -1 })
      .limit(RECENT_LIMIT)
      .toArray();
    console.log(`\nDerniers échecs :`);
    for (const doc of recent) {
      console.log(`  ${doc._id.toHexString()}  ${doc.reason} / ${doc.outcome} #${doc.attempt}  ${doc.url}\n      ${doc.detail}`);
    }

    const snapshots = await collection
      .find({ day, html: { $exists: true } }, { projection: { html: 0 } })
      .sort({ occurredAt: -1 })
      .toArray();
    if (snapshots.length > 0) {
      console.log(`\nPages conservées en HTML (--dump=<id> pour en extraire une) :`);
      for (const doc of snapshots) {
        console.log(`  ${doc._id.toHexString()}  ${doc.reason}  ${doc.url}`);
      }
    }
  } finally {
    await connection.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

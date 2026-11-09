import 'dotenv/config';
import type { AnyBulkWriteOperation } from 'mongodb';
import { MongoConnection } from '../infrastructure/persistence/mongodb/MongoConnection.js';
import { parseQuantity } from '../infrastructure/scraping/shared/QuantityParser.js';
import { reconcilePack } from '../infrastructure/scraping/shared/PackReconciler.js';

/**
 * Recalcule le conditionnement des relevés antérieurs à la séparation
 * « par unité / total » (champs `unitQuantity`, `unitDoses`).
 *
 * Pourquoi une migration est indispensable, et pas seulement souhaitable :
 * `build_price_history` réduit chaque champ d'identité à sa **dernière valeur
 * non nulle**. Or l'ancien parseur écrivait des valeurs que le nouveau refuse
 * désormais — `doses: 40` pour « Le Chat 2L 40 lavages - Lot de 2 », où l'on
 * ne sait pas si 40 porte sur la bouteille ou sur le lot. Le nouveau relevé
 * écrit `null`, et un `null` ne remplace jamais une valeur : l'ancienne,
 * fausse, resterait affichée tant que le relevé qui la porte existe.
 *
 * Seul le titre est relu, puisque c'est lui que ces anciens relevés ont
 * conservé ; la caractéristique « Nombre d'articles » n'était pas relevée, et
 * le nombre d'unités ressort donc tel que le titre l'établit. Les relevés
 * suivants, eux, la croisent.
 *
 * Idempotent : ne touche que les documents sans `unitQuantity`, champ que
 * tout relevé récent porte (à `null` au besoin).
 *
 * Usage :
 *   npm run migrate:reparse-quantities -- --dry-run   # compte, n'écrit rien
 *   npm run migrate:reparse-quantities
 *
 * À lancer avant le prochain `build_price_history` — sans quoi l'agrégation
 * tourne une nuit de plus sur les anciennes valeurs, sans autre dommage.
 */

interface RawDoc {
  _id: unknown;
  title?: unknown;
}

const BATCH_SIZE = 500;

async function main(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGODB_URI is not defined');
  const dryRun = process.argv.includes('--dry-run');

  const connection = new MongoConnection();
  await connection.connect(mongoUri);

  try {
    const collection = connection.db.collection<RawDoc>('items_raw');
    const cursor = collection.find(
      { unitQuantity: { $exists: false } },
      { projection: { _id: 1, title: 1 } },
    );

    let scanned = 0;
    let withPack = 0;
    let dosesRefused = 0;
    let written = 0;
    let batch: AnyBulkWriteOperation<RawDoc>[] = [];

    const flush = async (): Promise<void> => {
      if (batch.length === 0) return;
      if (!dryRun) await collection.bulkWrite(batch, { ordered: false });
      written += batch.length;
      batch = [];
    };

    for await (const doc of cursor) {
      scanned++;
      const title = typeof doc.title === 'string' ? doc.title : null;
      const parsed = parseQuantity(title);
      const pack = reconcilePack(parsed, null);
      if (pack.packSize !== null) withPack++;
      if (parsed.dosesAmbiguous) dosesRefused++;

      batch.push({
        updateOne: {
          filter: { _id: doc._id },
          update: {
            $set: {
              packSize: pack.packSize,
              quantity: pack.quantity,
              unitQuantity: pack.unitQuantity,
              doses: pack.doses,
              unitDoses: pack.unitDoses,
            },
          },
        },
      });
      if (batch.length >= BATCH_SIZE) await flush();
    }
    await flush();

    const verb = dryRun ? 'à réécrire (simulation, rien écrit)' : 'réécrits';
    console.log(`Relevés examinés : ${scanned}, ${verb} : ${written}`);
    console.log(`  dont lot établi par le titre : ${withPack}`);
    console.log(`  dont doses écartées (unité ou lot indécidable) : ${dosesRefused}`);
  } finally {
    await connection.disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

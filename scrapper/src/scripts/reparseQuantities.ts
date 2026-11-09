import 'dotenv/config';
import type { AnyBulkWriteOperation } from 'mongodb';
import { MongoConnection } from '../infrastructure/persistence/mongodb/MongoConnection.js';
import {
  PACK_FIELDS,
  packFieldsChanged,
  reparsePack,
  type PackFields,
} from '../infrastructure/scraping/shared/PackReconciler.js';

/**
 * Recalcule le conditionnement des relevés de `items_raw` avec le parseur
 * actuel.
 *
 * Pourquoi une migration est indispensable, et pas seulement souhaitable :
 * `build_price_history` réduit chaque champ d'identité à sa **dernière valeur
 * non nulle**. Quand le parseur change d'avis au point de refuser ce qu'il
 * acceptait, le nouveau relevé écrit `null` — et un `null` ne remplace jamais
 * une valeur : l'ancienne, fausse, reste affichée tant que le relevé qui la
 * porte existe. Deux cas réels :
 *
 * - séparation unité / total : l'ancien `doses: 40` de « Le Chat 2L 40
 *   lavages - Lot de 2 » (unité ou lot ?) ;
 * - pièces : « Pack de 4 brossettes » lu comme un **lot de 4** avant que les
 *   brossettes ne soient reconnues ; c'est un paquet de 4 pièces, et le
 *   nombre d'unités n'est pas établi.
 *
 * Le titre est relu ; le nombre d'articles déclaré par la fiche est repris de
 * `identityDiagnostics.declaredPackSize` quand le relevé l'a enregistré, ce qui
 * rend le recalcul identique à ce qu'aurait produit le scrape lui-même.
 *
 * Modes :
 *   (défaut)  relevés sans `unitQuantity` seulement — jamais migrés ;
 *   --all     tous les relevés : à relancer après chaque changement de parseur.
 * Seuls les relevés dont le conditionnement **change** sont réécrits : la
 * commande est idempotente, et le décompte de la simulation dit exactement ce
 * qu'elle corrigerait.
 *
 * Usage :
 *   npm run migrate:reparse-quantities -- --all --dry-run   # compte, n'écrit rien
 *   npm run migrate:reparse-quantities -- --all
 *   node dist/scripts/reparseQuantities.js --all            # dans l'image
 *
 * À lancer avant le prochain `build_price_history` — sans quoi l'agrégation
 * tourne une nuit de plus sur les anciennes valeurs, sans autre dommage.
 */

type RawDoc = Partial<PackFields> & {
  _id: unknown;
  title?: unknown;
  identityDiagnostics?: { declaredPackSize?: number | null } | null;
};

const BATCH_SIZE = 500;

async function main(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGODB_URI is not defined');
  const dryRun = process.argv.includes('--dry-run');
  const all = process.argv.includes('--all');

  const connection = new MongoConnection();
  await connection.connect(mongoUri);

  try {
    const collection = connection.db.collection<RawDoc>('items_raw');
    const projection = Object.fromEntries(
      ['title', 'identityDiagnostics.declaredPackSize', ...PACK_FIELDS].map((name) => [name, 1]),
    );
    const cursor = collection.find(all ? {} : { unitQuantity: { $exists: false } }, { projection });

    let scanned = 0;
    let changed = 0;
    let packSizeChanged = 0;
    let falseLotsCleared = 0;
    let batch: AnyBulkWriteOperation<RawDoc>[] = [];

    const flush = async (): Promise<void> => {
      if (batch.length === 0) return;
      if (!dryRun) await collection.bulkWrite(batch, { ordered: false });
      batch = [];
    };

    for await (const doc of cursor) {
      scanned++;
      const title = typeof doc.title === 'string' ? doc.title : null;
      const declared = doc.identityDiagnostics?.declaredPackSize ?? null;
      const next = reparsePack(title, declared);
      if (!packFieldsChanged(doc, next)) continue;

      changed++;
      if ((doc.packSize ?? null) !== next.packSize) packSizeChanged++;
      if ((doc.packSize ?? 0) > 1 && next.packSize === null) falseLotsCleared++;

      batch.push({ updateOne: { filter: { _id: doc._id }, update: { $set: next } } });
      if (batch.length >= BATCH_SIZE) await flush();
    }
    await flush();

    const scope = all ? 'tous les relevés' : 'relevés jamais migrés';
    const verb = dryRun ? 'à réécrire (simulation, rien écrit)' : 'réécrits';
    console.log(`Relevés examinés (${scope}) : ${scanned}, ${verb} : ${changed}`);
    console.log(`  dont nombre d'unités modifié : ${packSizeChanged}`);
    console.log(`  dont lot ≥ 2 désormais non établi (ex. « Pack de 4 brossettes ») : ${falseLotsCleared}`);
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

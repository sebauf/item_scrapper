import { Db, IndexSpecification } from 'mongodb';

/**
 * Index requis par les lectures du backend.
 *
 * Ils ne dupliquent pas ceux du scrapper (`items_raw {url, day}` unique et
 * `keywords {keyword}` unique, cf. scrapper/src/infrastructure/persistence/
 * mongodb/MongoConnection.ts) : ceux-ci servent les tris et filtres des écrans.
 *
 * createIndex est idempotent tant que la spec ne change pas — les appliquer à
 * chaque démarrage est donc sans effet une fois créés.
 */
interface IndexDefinition {
  collection: string;
  keys: IndexSpecification;
  name: string;
  /** Pourquoi cet index existe — à maintenir si une requête change. */
  reason: string;
}

export const REQUIRED_INDEXES: readonly IndexDefinition[] = [
  {
    collection: 'items_raw',
    keys: { keyword: 1, day: -1, scrapedAt: -1 },
    name: 'keyword_day_scrapedAt',
    reason: "liste produits d'un mot-clé : $match keyword puis $sort day/scrapedAt",
  },
  {
    collection: 'items_raw',
    keys: { url: 1, day: -1, scrapedAt: -1 },
    name: 'url_day_scrapedAt',
    reason: 'détail produit : dernier snapshot connu pour une URL',
  },
  {
    collection: 'price_history',
    keys: { updatedAt: -1 },
    name: 'updatedAt_desc',
    reason: 'dashboard : date de dernière mise à jour du pipeline',
  },
  {
    collection: 'deal_scores',
    keys: { score: -1 },
    name: 'score_desc',
    reason: 'dashboard : comptage des scores au-dessus du seuil de bonne affaire',
  },
];

/** Crée les index manquants. Renvoie les noms de ceux effectivement créés. */
export async function ensureIndexes(db: Db): Promise<string[]> {
  const created: string[] = [];
  for (const index of REQUIRED_INDEXES) {
    const existing = await db.collection(index.collection).indexExists(index.name);
    if (existing) continue;
    await db.collection(index.collection).createIndex(index.keys, { name: index.name });
    created.push(`${index.collection}.${index.name}`);
  }
  return created;
}

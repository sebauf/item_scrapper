import { CreateIndexesOptions, Db, IndexSpecification, MongoServerError } from 'mongodb';

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
  options?: Omit<CreateIndexesOptions, 'name'>;
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
    collection: 'items_raw',
    keys: { day: -1 },
    name: 'day_desc',
    reason:
      'fraîcheur : date du dernier passage du scrapper, puis filtre de ce jour sur toutes les listes',
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
  {
    collection: 'fuel_stations',
    keys: { location: '2dsphere' },
    name: 'location_2dsphere',
    reason: 'carte des carburants : $geoNear est refusé par Mongo sans index géospatial',
  },
  {
    collection: 'fuel_stations',
    keys: { importedAt: -1 },
    name: 'importedAt_desc',
    reason: 'carte des carburants : date du dernier import du flux officiel',
  },
  {
    collection: 'keywords',
    keys: { subscribers: 1 },
    name: 'subscribers',
    reason: "mots-clés d'un utilisateur : `{ subscribers: email }` (index multikey sur le tableau)",
  },
  {
    collection: 'tracked_urls',
    keys: { subscribers: 1 },
    name: 'subscribers',
    reason: "URLs suivies d'un utilisateur : `{ subscribers: email }` (index multikey)",
  },
  {
    collection: 'favorites',
    keys: { userId: 1, url: 1 },
    name: 'userId_url',
    // Partiel : un document historique pas encore rattaché (sans `userId`)
    // ne doit pas faire échouer la création de l'index.
    options: { unique: true, partialFilterExpression: { userId: { $exists: true } } },
    reason: "favoris d'un utilisateur, et unicité d'un favori par (utilisateur, produit)",
  },
  {
    collection: 'favorite_stations',
    keys: { userId: 1, stationId: 1 },
    name: 'userId_stationId',
    options: { unique: true, partialFilterExpression: { userId: { $exists: true } } },
    reason: "stations favorites d'un utilisateur, unicité par (utilisateur, station)",
  },
];

/** Crée les index manquants. Renvoie les noms de ceux effectivement créés. */
export async function ensureIndexes(db: Db): Promise<string[]> {
  const created: string[] = [];
  for (const index of REQUIRED_INDEXES) {
    const existing = await indexExists(db, index.collection, index.name);
    if (existing) continue;
    await db
      .collection(index.collection)
      .createIndex(index.keys, { ...index.options, name: index.name });
    created.push(`${index.collection}.${index.name}`);
  }
  return created;
}

/** Code Mongo d'une collection inexistante. */
const NAMESPACE_NOT_FOUND = 26;

/**
 * `indexExists` lève `NamespaceNotFound` sur une collection qui n'existe pas
 * encore — `favorites` tant que personne n'a mis de favori, `price_history`
 * avant le premier passage du pipeline. Ce n'est pas une erreur ici : l'index
 * n'existe pas, et `createIndex` créera la collection avec lui. Sans ce cas,
 * le backend refusait de démarrer sur une base neuve.
 */
async function indexExists(db: Db, collection: string, name: string): Promise<boolean> {
  try {
    return await db.collection(collection).indexExists(name);
  } catch (error) {
    if (error instanceof MongoServerError && error.code === NAMESPACE_NOT_FOUND) return false;
    throw error;
  }
}

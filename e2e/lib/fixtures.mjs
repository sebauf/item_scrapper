/**
 * Données et secrets de la pile de test. Tout est fictif et propre à cette
 * suite : aucun de ces secrets ne sert ailleurs.
 */
export const SECRETS = {
  /** Frontend → backend. */
  backend: 'e2e-frontend-secret-'.padEnd(64, 'f'),
  /** MCP → backend, accepté uniquement pour AGENT. */
  mcp: 'e2e-mcp-secret-'.padEnd(64, 'm'),
  /** Cookie de session Auth.js. */
  session: 'e2e-session-secret-'.padEnd(64, 's'),
};

export const ALICE = 'alice@example.com';
export const BOB = 'bob@example.com';
/** Compte Google valide, mais absent de la liste blanche. */
export const INTRUDER = 'intrus@example.com';
/** Compte du serveur MCP. */
export const AGENT = 'agent@example.com';

export const QUOTAS = { keywords: 3, trackedUrls: 2 };

/** URL publique de l'instance « production » du frontend. */
export const PUBLIC_URL = 'https://prix.example.test';

export const PRODUCT_A = 'https://www.amazon.fr/dp/B0LESSIVE1/';
export const PRODUCT_B = 'https://www.amazon.fr/dp/B0CAFE0001/';
export const STATION = '69003001';

/** Identifiant opaque d'un produit, comme le renvoie l'API (base64url de l'URL). */
export function productId(url) {
  return Buffer.from(url, 'utf8').toString('base64url');
}

/**
 * Situation de départ : Alice a des données personnelles de chaque sorte, Bob
 * n'en a aucune. Chaque test d'attaque consiste à faire toucher par Bob (ou
 * un anonyme, ou un intrus) ce qui appartient à Alice.
 */
export async function seed(db) {
  const day = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
  const scrapedAt = new Date();
  await db.collection('items_raw').insertMany([
    { url: PRODUCT_A, keyword: 'lessive', shop: 'amazon', title: 'Lessive Alice 3L', price: { amount: 12, currency: 'EUR' }, images: [], day, scrapedAt },
    { url: PRODUCT_B, keyword: 'cafe', shop: 'amazon', title: 'Café Alice 1kg', price: { amount: 9, currency: 'EUR' }, images: [], day, scrapedAt },
  ]);
  await db.collection('keywords').insertMany([
    { keyword: 'lessive', enabled: true, subscribers: [ALICE] },
    { keyword: 'cafe', enabled: true, subscribers: [ALICE] },
  ]);
  await db.collection('tracked_urls').insertOne({ url: PRODUCT_A, enabled: true, subscribers: [ALICE] });
  await db.collection('favorites').insertOne({ userId: ALICE, url: PRODUCT_A, addedAt: scrapedAt });
  await db.collection('favorite_stations').insertOne({ userId: ALICE, stationId: STATION, addedAt: scrapedAt });
  await db.collection('fuel_stations').insertOne({
    _id: STATION,
    location: { type: 'Point', coordinates: [4.85491, 45.75938] },
    brand: 'TotalEnergies',
    address: '12 avenue Félix Faure',
    city: 'Lyon',
    postcode: '69003',
    fuels: [],
    importedAt: scrapedAt,
  });
}

import { normalizeGtin } from './Gtin.js';

/**
 * Lecture des blocs `<script type="application/ld+json">` d'une fiche produit.
 *
 * Intérêt pour le rapprochement inter-enseignes : schema.org normalise les
 * champs d'identité — `gtin13`, `brand`, `mpn`, `sku` — que chaque site
 * expose autrement dans son HTML. Un seul parseur remplace donc autant de
 * jeux de sélecteurs CSS qu'il y a d'enseignes, et résiste aux refontes
 * graphiques : le balisage SEO bouge beaucoup moins que la mise en page.
 *
 * Ce module est volontairement **agnostique de la boutique** et sans
 * dépendance : il prend le contenu textuel des scripts et rend des objets.
 * L'accès au DOM appartient aux handlers, la structure de la donnée à ce
 * fichier — même séparation que `PriceParser`, pur lui aussi.
 *
 * Robustesse : un JSON-LD mal formé ne doit jamais interrompre un scrape.
 * Toutes les erreurs de parsing sont avalées et le bloc fautif ignoré ; au
 * pire la fiche ressort sans identifiant, ce que la cascade de
 * rapprochement sait déjà traiter.
 */

export interface JsonLdProduct {
  name: string | null;
  brand: string | null;
  /** GTIN normalisé sur 13 chiffres et vérifié par sa clé de contrôle. */
  gtin: string | null;
  mpn: string | null;
  sku: string | null;
  price: number | null;
  currency: string | null;
}

/** Garde-fou : une page pathologique ne doit pas faire exploser la pile. */
const MAX_DEPTH = 12;
const MAX_NODES = 5000;

/** Les champs schema.org qui portent un code-barres, par ordre de préférence. */
const GTIN_FIELDS = ['gtin13', 'gtin', 'gtin12', 'gtin14', 'gtin8'] as const;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `@type` peut être une chaîne ou un tableau ; les deux sont valides. */
function hasType(node: JsonObject, expected: string): boolean {
  const type = node['@type'];
  if (typeof type === 'string') return type === expected;
  if (Array.isArray(type)) return type.some((t) => t === expected);
  return false;
}

function firstString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item);
      if (found !== null) return found;
    }
  }
  return null;
}

/** `brand` est tantôt une chaîne, tantôt un objet `{ @type: Brand, name }`. */
function readBrand(value: unknown): string | null {
  if (isObject(value)) return firstString(value.name);
  return firstString(value);
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    // Les prix schema.org sont en notation anglo-saxonne, mais certains
    // sites français publient « 12,90 » : on accepte les deux.
    const parsed = Number(value.replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** `offers` : objet unique, tableau, ou `AggregateOffer` avec `lowPrice`. */
function readOffer(value: unknown): { price: number | null; currency: string | null } {
  const candidates = Array.isArray(value) ? value : [value];
  for (const candidate of candidates) {
    if (!isObject(candidate)) continue;
    const price = readNumber(candidate.price) ?? readNumber(candidate.lowPrice);
    const currency = firstString(candidate.priceCurrency);
    if (price !== null || currency !== null) return { price, currency };
  }
  return { price: null, currency: null };
}

/**
 * Certains sites publient le code-barres dans `productID` sous la forme
 * « ean:3014260610807 » ou « gtin13:… ». On ne le lit qu'en dernier recours,
 * et la clé de contrôle fait le tri.
 */
function readGtin(node: JsonObject): string | null {
  for (const field of GTIN_FIELDS) {
    const normalized = normalizeGtin(firstString(node[field]));
    if (normalized !== null) return normalized;
  }
  const productId = firstString(node.productID);
  if (productId !== null && /^(?:ean|gtin\d*|upc)[:\s]/i.test(productId)) {
    return normalizeGtin(productId.replace(/^[^:\s]+[:\s]\s*/, ''));
  }
  return null;
}

function toJsonLdProduct(node: JsonObject): JsonLdProduct {
  const { price, currency } = readOffer(node.offers);
  return {
    name: firstString(node.name),
    brand: readBrand(node.brand),
    gtin: readGtin(node),
    mpn: firstString(node.mpn),
    sku: firstString(node.sku),
    price,
    currency,
  };
}

/**
 * Parcourt récursivement un document JSON-LD à la recherche des nœuds
 * `Product`. La récursion est nécessaire : les nœuds utiles sont selon les
 * sites à la racine, dans un tableau, sous `@graph`, ou imbriqués sous
 * `mainEntity` / `itemListElement`.
 */
function collectProducts(value: unknown, depth: number, budget: { left: number }): JsonObject[] {
  if (depth > MAX_DEPTH || budget.left <= 0) return [];
  budget.left--;

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectProducts(item, depth + 1, budget));
  }
  if (!isObject(value)) return [];

  const found: JsonObject[] = [];
  if (hasType(value, 'Product')) found.push(value);

  for (const child of Object.values(value)) {
    if (isObject(child) || Array.isArray(child)) {
      found.push(...collectProducts(child, depth + 1, budget));
    }
  }
  return found;
}

/**
 * @param rawScripts contenu textuel de chaque balise `application/ld+json`
 * @returns un descripteur par nœud `Product` trouvé, dans l'ordre du document
 */
export function parseJsonLdProducts(rawScripts: readonly string[]): JsonLdProduct[] {
  const products: JsonLdProduct[] = [];

  for (const raw of rawScripts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue; // bloc mal formé : ignoré, jamais bloquant
    }
    const budget = { left: MAX_NODES };
    for (const node of collectProducts(parsed, 0, budget)) {
      products.push(toJsonLdProduct(node));
    }
  }

  return products;
}

/**
 * Fusionne les nœuds `Product` d'une page en un seul descripteur.
 *
 * Une fiche en publie parfois plusieurs (le produit principal, puis des
 * suggestions). On retient, champ par champ, la première valeur non vide —
 * le nœud principal étant en pratique le premier du document.
 *
 * Renvoie `null` si la page n'expose aucun `Product` : c'est une information
 * en soi, et le mesurer est l'objet du spike.
 */
export function mergeJsonLdProducts(products: readonly JsonLdProduct[]): JsonLdProduct | null {
  if (products.length === 0) return null;

  const pick = <K extends keyof JsonLdProduct>(key: K): JsonLdProduct[K] => {
    for (const product of products) {
      if (product[key] !== null) return product[key];
    }
    return null as JsonLdProduct[K];
  };

  return {
    name: pick('name'),
    brand: pick('brand'),
    gtin: pick('gtin'),
    mpn: pick('mpn'),
    sku: pick('sku'),
    price: pick('price'),
    currency: pick('currency'),
  };
}

export interface Price {
  amount: number;
  currency: string;
}

export interface UnitPrice {
  amount: number;
  unit: string;
}

/**
 * Contenance ramenée à une unité de base (litre ou kilogramme).
 *
 * Distincte de `UnitPrice`, qui est un *prix* rapporté à une unité : celle-ci
 * décrit ce que contient l'article. C'est le champ qui autorise à comparer
 * deux offres entre elles — sans lui, un 1,5 L et un 3 L du même produit
 * afficheraient un écart de prix qui n'est qu'un écart de format.
 */
export interface Quantity {
  amount: number;
  unit: 'L' | 'kg';
}

export interface Product {
  url: string;
  title: string;
  price: Price | null;
  crossedOutPrice: Price | null;
  unitPrice: UnitPrice | null;
  deliveryDate: string | null;
  images: string[];
  shop: string;
  keyword: string | null;
  scrapedAt: Date;

  // Identité de l'article, indépendante de la boutique qui le vend.
  //
  // Tous ces champs sont facultatifs par nécessité : une fiche ne publie pas
  // toujours son code-barres. C'est précisément pourquoi le rapprochement
  // inter-enseignes est pensé comme une cascade — l'EAN quand il existe, les
  // attributs sinon — et non comme un unique identifiant obligatoire.

  /** GTIN-13 vérifié par sa clé de contrôle, ou `null` si absent ou ambigu. */
  ean: string | null;
  brand: string | null;
  /** Référence fabricant, second identifiant quand l'EAN manque. */
  mpn: string | null;
  /** Contenance totale, multiplicateur de lot appliqué. */
  quantity: Quantity | null;
  /** Nombre d'unités du lot (« lot de 3 »), `null` si vendu à l'unité. */
  packSize: number | null;
  /** Nombre de lavages / doses / capsules annoncé. */
  doses: number | null;
}

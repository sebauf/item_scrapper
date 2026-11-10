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

/**
 * Comment l'identité a été lue sur la fiche — pas ce qu'est l'article, mais
 * ce que le scrapper a vu. Sans ces traces, une couverture d'EAN faible ne
 * dit pas si l'enseigne ne publie pas le code-barres ou si le scrapper ne
 * sait plus le lire : deux causes aux remèdes opposés (chercher l'identité
 * ailleurs, ou réparer un sélecteur). Écrit dans `items_raw` seulement.
 */
export interface IdentityDiagnostics {
  /** Source de l'EAN retenu, `null` si aucun. */
  eanSource: 'json-ld' | 'details' | null;
  /** La page publie un nœud JSON-LD de type `Product`. */
  jsonLdProduct: boolean;
  /** Lignes lues dans la section de caractéristiques (0 = rien lu). */
  detailEntries: number;
  /** Libellés lus, normalisés (sans accents, minuscules), dédoublonnés. */
  detailLabels: string[];
  /** Conteneurs de caractéristiques connus présents dans la page. */
  detailContainers: string[];
  /** Le texte de la page contient « EAN », « GTIN » ou « Global Trade Identification Number ». */
  mentionsEan: boolean;
  /** Le texte de la page contient « Nombre d'articles » ou « Number of items ». */
  mentionsItemCount: boolean;
  /** Nombre d'articles déclaré par la fiche, avant croisement avec le titre. */
  declaredPackSize: number | null;
  /** Désaccord titre / fiche sur le conditionnement, s'il y en a un. */
  packIssue: string | null;
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
  //
  // Conditionnement. Un EAN désigne l'unité fabriquée (la bouteille) ; un lot
  // constitué par le vendeur reprend souvent ce même EAN. Deux offres ne sont
  // donc identiques que si elles ont même EAN **et** même `packSize` — d'où
  // la séparation entre grandeurs par unité (l'article) et totales (l'offre).

  /**
   * Nombre d'unités vendues ensemble. `1` = vendu à l'unité, déclaré par la
   * fiche ; `null` = non établi (titre muet et fiche muette, ou désaccord).
   * Un titre sans « lot de » ne suffit pas à écrire `1`.
   */
  packSize: number | null;
  /** Contenance totale de l'offre, multiplicateur de lot appliqué. */
  quantity: Quantity | null;
  /** Contenance d'une unité du lot. */
  unitQuantity: Quantity | null;
  /** Nombre total de lavages / doses / capsules de l'offre. */
  doses: number | null;
  /** Nombre de lavages / doses / capsules d'une unité du lot. */
  unitDoses: number | null;

  /** Traces de l'extraction d'identité, `null` si la boutique n'en produit pas. */
  identityDiagnostics: IdentityDiagnostics | null;
}

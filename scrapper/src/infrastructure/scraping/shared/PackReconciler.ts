import type { Quantity } from '../../../domain/product/Product.js';
import type { ParsedQuantity } from './QuantityParser.js';

/**
 * Nombre d'unités d'une offre : croisement du titre et de ce que la fiche
 * déclare ailleurs (caractéristiques chez Amazon, JSON-LD ou fiche technique
 * ailleurs).
 *
 * Pourquoi ce champ mérite deux sources. Un EAN identifie l'**unité** que
 * fabrique la marque — la bouteille. Un lot constitué par le vendeur (« lot
 * de 2 » Amazon, Marketplace, certains drives) reprend en général l'EAN de
 * cette bouteille. Deux offres de même EAN ne sont donc identiques que si
 * elles contiennent **autant d'unités** : la clé de comparaison stricte est
 * `(EAN, nombre d'unités)`, et ce module en fournit la seconde moitié.
 *
 * D'où l'exigence de distinguer « 1 » d'« inconnu ». Un titre muet sur le lot
 * ne prouve pas que l'article est vendu à l'unité ; seule une déclaration de
 * la fiche le prouve. `packSize: 1` n'est donc écrit que sur déclaration,
 * `null` signifie « non établi », et l'étage de rapprochement ne compare
 * jamais strictement une offre dont le lot est inconnu.
 *
 * Module agnostique de la boutique et sans dépendance, comme les autres
 * parseurs de `shared/`.
 */

export type PackIssue =
  /** Le titre et la fiche annoncent deux nombres d'unités différents. */
  | 'pack-conflict'
  /**
   * La fiche annonce un lot que le titre ne mentionne pas : impossible de
   * savoir si la contenance du titre est celle d'une unité ou du lot.
   */
  | 'per-unit-undetermined'
  /**
   * La fiche déclare N articles, le titre annonce N pièces (« 8 brossettes »,
   * nombre d'articles : 8) : un paquet de 8 ou 8 unités d'une pièce ? Le
   * total — 8 pièces — est vrai dans les deux lectures, le reste non.
   */
  | 'pieces-or-pack';

export interface PackIdentity {
  /** Nombre d'unités de l'offre ; `1` = vendu à l'unité, déclaré ; `null` = non établi. */
  packSize: number | null;
  /** Contenance totale de l'offre. */
  quantity: Quantity | null;
  /** Contenance d'une unité. */
  unitQuantity: Quantity | null;
  /** Doses totales de l'offre. */
  doses: number | null;
  /** Doses d'une unité. */
  unitDoses: number | null;
  /** Désaccord ou indétermination relevé, à journaliser ; `null` si rien à signaler. */
  issue: PackIssue | null;
}

export const EMPTY_PACK: PackIdentity = Object.freeze({
  packSize: null,
  quantity: null,
  unitQuantity: null,
  doses: null,
  unitDoses: null,
  issue: null,
});

function isPositiveInteger(value: number | null): value is number {
  return value !== null && Number.isInteger(value) && value > 0;
}

/**
 * @param title ce que le titre dit du conditionnement (`parseQuantity`)
 * @param declaredPackSize nombre d'unités déclaré par la fiche, `null` si
 *   elle n'en publie pas
 */
export function reconcilePack(title: ParsedQuantity, declaredPackSize: number | null): PackIdentity {
  const declared = isPositiveInteger(declaredPackSize) ? declaredPackSize : null;
  const fromTitle = {
    quantity: title.quantity,
    unitQuantity: title.unitQuantity,
    doses: title.doses,
    unitDoses: title.unitDoses,
  };

  if (title.packSize !== null) {
    if (declared === null || declared === title.packSize) {
      return { packSize: title.packSize, ...fromTitle, issue: null };
    }
    // Le lot est contesté, donc les totaux aussi. Les grandeurs unitaires,
    // elles, décrivent l'article et restent vraies dans les deux lectures :
    // « 3 x 1 L » dit qu'une bouteille fait 1 L, qu'on en vende une ou trois.
    return {
      ...EMPTY_PACK,
      unitQuantity: title.unitQuantity,
      unitDoses: title.unitDoses,
      issue: 'pack-conflict',
    };
  }

  // Titre muet sur le lot.
  if (declared === null) return { packSize: null, ...fromTitle, issue: null };
  if (declared === 1) return { packSize: 1, ...fromTitle, issue: null };

  if (title.unitDoses !== null && title.unitDoses === declared) {
    return { ...EMPTY_PACK, doses: declared, issue: 'pieces-or-pack' };
  }

  // La fiche déclare N unités, le titre n'en dit rien : « Lessive 4,5 L »
  // peut être une bouteille de 4,5 L dans un lot de 3, ou trois de 1,5 L. On
  // garde le nombre d'unités, qui est établi, et rien de ce qu'il faudrait
  // deviner.
  return { ...EMPTY_PACK, packSize: declared, issue: 'per-unit-undetermined' };
}

/**
 * Extraction de la contenance depuis un titre de fiche produit.
 *
 * C'est le champ qui rend la comparaison *stricte* possible. Deux offres de
 * la même lessive en 1,5 L et en 3 L sont le même article mais pas la même
 * offre : les rapprocher sans normaliser la contenance afficherait
 * « 4,90 € ici, 9,50 € là » comme si c'était un écart de prix, alors que
 * c'est un écart de format.
 *
 * Tout est ramené à une unité de base — litre, kilogramme — pour que
 * « 750 ml », « 75 cl » et « 0,75 L » soient reconnus comme une seule et
 * même contenance.
 *
 * Principe directeur, hérité de l'exigence de strictesse : **en cas
 * d'ambiguïté, ne rien renvoyer**. Un titre qui contient deux contenances
 * (« Lessive 1 L + Adoucissant 750 ml ») est un lot hétérogène ; deviner
 * laquelle est la bonne produirait un faux rapprochement. Un faux négatif
 * coûte une comparaison manquante, un faux positif coûte la confiance dans
 * l'outil : l'asymétrie tranche.
 */

import type { Quantity } from '../../../domain/product/Product.js';

export type { Quantity };

/**
 * L'unité de base vient du domaine : c'est lui qui décide de ce qui est
 * comparable. L'infrastructure ne fait que reconnaître les écritures.
 */
export type QuantityUnit = Quantity['unit'];

export interface ParsedQuantity {
  /** Contenance totale, multiplicateur de lot appliqué. */
  quantity: Quantity | null;
  /** Nombre d'unités du lot (« lot de 3 », « 3 x 1 L »), `null` si unitaire. */
  packSize: number | null;
  /** Contenance d'une unité du lot. */
  perPack: Quantity | null;
  /** Nombre de lavages / doses / capsules annoncé. */
  doses: number | null;
  /** Plusieurs contenances incompatibles trouvées : rien n'est renvoyé. */
  ambiguous: boolean;
  /** Fragment reconnu, conservé pour audit et mise au point. */
  raw: string | null;
}

const EMPTY: ParsedQuantity = {
  quantity: null,
  packSize: null,
  perPack: null,
  doses: null,
  ambiguous: false,
  raw: null,
};

/** Facteur de conversion vers l'unité de base, par unité écrite. */
const UNIT_FACTORS: Record<string, { factor: number; unit: QuantityUnit }> = {
  ml: { factor: 0.001, unit: 'L' },
  cl: { factor: 0.01, unit: 'L' },
  dl: { factor: 0.1, unit: 'L' },
  l: { factor: 1, unit: 'L' },
  litre: { factor: 1, unit: 'L' },
  litres: { factor: 1, unit: 'L' },
  mg: { factor: 0.000001, unit: 'kg' },
  g: { factor: 0.001, unit: 'kg' },
  gr: { factor: 0.001, unit: 'kg' },
  kg: { factor: 1, unit: 'kg' },
};

const NUMBER = String.raw`\d+(?:[.,]\d+)?`;
const UNITS = Object.keys(UNIT_FACTORS).sort((a, b) => b.length - a.length).join('|');

/**
 * La négation finale `(?![a-zà-ÿ])` est indispensable : sans elle, le « l »
 * de « 1 litre » se retrouverait aussi dans « 1 lessive », et le « g » de
 * « 500 g » dans « 500 gouttes ».
 */
const QUANTITY_RE = new RegExp(String.raw`(${NUMBER})\s*(${UNITS})(?![a-zà-ÿ])`, 'gi');

/** « 3 x 1 L », « 2×500 ml », « 4 X 1,5L » — le multiplicateur précède. */
const MULTIPLIED_RE = new RegExp(
  String.raw`(\d+)\s*[x×*]\s*(${NUMBER})\s*(${UNITS})(?![a-zà-ÿ])`,
  'i',
);

/** « 1 L x 3 » — le multiplicateur suit. */
const MULTIPLIED_SUFFIX_RE = new RegExp(
  String.raw`(${NUMBER})\s*(${UNITS})(?![a-zà-ÿ])\s*[x×*]\s*(\d+)\b`,
  'i',
);

/** « lot de 3 », « pack de 2 », « paquet de 6 ». */
const PACK_RE = /(?:lot|pack|paquet|set)\s+de\s+(\d+)\b/i;

/** « 60 lavages », « 48 doses », « 30 capsules ». */
const DOSES_RE =
  /(\d+)\s*(?:lavages?|doses?|capsules?|tablettes?|pastilles?|sachets?|lingettes?)\b/i;

function toNumber(raw: string): number {
  return Number(raw.replace(',', '.'));
}

function toQuantity(rawAmount: string, rawUnit: string): Quantity | null {
  const spec = UNIT_FACTORS[rawUnit.toLowerCase()];
  if (!spec) return null;
  const amount = toNumber(rawAmount) * spec.factor;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  // Les flottants binaires transforment 3 × 0,001 en 0,003000000000000000...
  // Six décimales suffisent à distinguer un millilitre, et rendent deux
  // contenances identiques strictement égales — condition d'un rapprochement.
  return { amount: Number(amount.toFixed(6)), unit: spec.unit };
}

/** Normalise les espaces exotiques des titres marchands (insécables compris). */
function normalize(title: string): string {
  return title.replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function sameQuantity(a: Quantity, b: Quantity): boolean {
  return a.unit === b.unit && Math.abs(a.amount - b.amount) < 1e-9;
}

export function parseQuantity(title: string | null | undefined): ParsedQuantity {
  if (typeof title !== 'string' || title.trim().length === 0) return EMPTY;

  const text = normalize(title);
  const doses = DOSES_RE.exec(text);
  const dosesCount = doses ? Number(doses[1]) : null;

  // Les deux formes de multiplicateur sont testées séparément : leurs
  // groupes capturants ne sont pas dans le même ordre, et les confondre
  // donnerait « 3 x 1 L » = 1 lot de 3 L au lieu de 3 lots de 1 L.
  const prefix = MULTIPLIED_RE.exec(text);
  const suffix = prefix ? null : MULTIPLIED_SUFFIX_RE.exec(text);
  const multiplied = prefix
    ? { count: prefix[1], amount: prefix[2], unit: prefix[3], raw: prefix[0] }
    : suffix
      ? { count: suffix[3], amount: suffix[1], unit: suffix[2], raw: suffix[0] }
      : null;

  if (multiplied) {
    const perPack = toQuantity(multiplied.amount, multiplied.unit);
    const packSize = Number(multiplied.count);
    if (perPack && Number.isInteger(packSize) && packSize > 0) {
      return {
        quantity: {
          amount: Number((perPack.amount * packSize).toFixed(6)),
          unit: perPack.unit,
        },
        packSize,
        perPack,
        doses: dosesCount,
        ambiguous: false,
        raw: multiplied.raw,
      };
    }
  }

  // Toutes les contenances citées dans le titre. Plusieurs valeurs
  // *différentes* signent un lot hétérogène : on refuse plutôt que de choisir.
  const found: Array<{ quantity: Quantity; raw: string }> = [];
  for (const match of text.matchAll(QUANTITY_RE)) {
    const quantity = toQuantity(match[1], match[2]);
    if (quantity) found.push({ quantity, raw: match[0] });
  }

  const distinct = found.filter(
    (item, index) => found.findIndex((other) => sameQuantity(other.quantity, item.quantity)) === index,
  );

  if (distinct.length === 0) {
    return { ...EMPTY, doses: dosesCount };
  }
  if (distinct.length > 1) {
    return { ...EMPTY, doses: dosesCount, ambiguous: true };
  }

  const pack = PACK_RE.exec(text);
  const packSize = pack ? Number(pack[1]) : null;
  const unitary = distinct[0].quantity;

  if (packSize !== null && packSize > 1) {
    return {
      quantity: { amount: Number((unitary.amount * packSize).toFixed(6)), unit: unitary.unit },
      packSize,
      perPack: unitary,
      doses: dosesCount,
      ambiguous: false,
      raw: `${pack?.[0]} ${distinct[0].raw}`,
    };
  }

  return {
    quantity: unitary,
    packSize: null,
    perPack: null,
    doses: dosesCount,
    ambiguous: false,
    raw: distinct[0].raw,
  };
}

/** Vrai si rien d'exploitable n'a été trouvé — raccourci pour les statistiques. */
export function isEmptyQuantity(parsed: ParsedQuantity): boolean {
  return parsed.quantity === null && parsed.doses === null;
}

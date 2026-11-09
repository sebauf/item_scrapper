/**
 * Extraction de la contenance et du conditionnement depuis un titre de fiche.
 *
 * C'est le champ qui rend la comparaison *stricte* possible. Deux offres de
 * la même lessive en 1,5 L et en 3 L sont le même article mais pas la même
 * offre : les rapprocher sans normaliser la contenance afficherait
 * « 4,90 € ici, 9,50 € là » comme si c'était un écart de prix, alors que
 * c'est un écart de format. Il en va de même du **lot** : une bouteille et un
 * lot de deux bouteilles portent souvent le même EAN — celui de l'unité —
 * et seul le nombre d'unités les distingue.
 *
 * Tout est ramené à une unité de base — litre, kilogramme — pour que
 * « 750 ml », « 75 cl » et « 0,75 L » soient reconnus comme une seule et
 * même contenance.
 *
 * Deux familles de grandeurs, à ne pas mélanger :
 *
 * - **par unité** (`unitQuantity`, `unitDoses`) : ce que contient *un*
 *   article du lot — la bouteille, la boîte. C'est ce qui décrit l'article ;
 * - **totales** (`quantity`, `doses`) : ce que contient l'offre entière,
 *   multiplicateur de lot appliqué. C'est ce qu'on paie.
 *
 * Principe directeur, hérité de l'exigence de strictesse : **en cas
 * d'ambiguïté, ne rien renvoyer**. Un titre qui contient deux contenances
 * (« Lessive 1 L + Adoucissant 750 ml ») est un lot hétérogène ; deviner
 * laquelle est la bonne produirait un faux rapprochement. Un faux négatif
 * coûte une comparaison manquante, un faux positif coûte la confiance dans
 * l'outil : l'asymétrie tranche.
 *
 * Ce module ne lit que le titre. Le croisement avec le nombre d'unités que la
 * fiche déclare ailleurs (caractéristiques, JSON-LD) est l'affaire de
 * `PackReconciler`.
 */

import type { Quantity } from '../../../domain/product/Product.js';

export type { Quantity };

/**
 * L'unité de base vient du domaine : c'est lui qui décide de ce qui est
 * comparable. L'infrastructure ne fait que reconnaître les écritures.
 */
export type QuantityUnit = Quantity['unit'];

export interface ParsedQuantity {
  /** Contenance totale de l'offre, multiplicateur de lot appliqué. */
  quantity: Quantity | null;
  /** Contenance d'une unité ; égale à `quantity` quand le titre n'écrit aucun lot. */
  unitQuantity: Quantity | null;
  /**
   * Nombre d'unités **écrit dans le titre** (« lot de 3 », « 3 x 1 L »,
   * « 3 x 40 tablettes »), `null` si le titre n'en dit rien. `null` ne veut
   * donc pas dire « vendu à l'unité » : le titre se tait, c'est tout.
   */
  packSize: number | null;
  /** Doses totales de l'offre (lavages, capsules, tablettes…). */
  doses: number | null;
  /** Doses d'une unité du lot. */
  unitDoses: number | null;
  /** Contenances incompatibles, ou lot écrit de deux façons contradictoires. */
  ambiguous: boolean;
  /**
   * Nombres de doses incompatibles, ou impossible de dire s'ils portent sur
   * l'unité ou sur le lot : doses non retenues.
   */
  dosesAmbiguous: boolean;
  /** Fragments reconnus, conservés pour audit et mise au point. */
  raw: string | null;
}

export const EMPTY_PARSED_QUANTITY: ParsedQuantity = Object.freeze({
  quantity: null,
  unitQuantity: null,
  packSize: null,
  doses: null,
  unitDoses: null,
  ambiguous: false,
  dosesAmbiguous: false,
  raw: null,
});

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
 * Le multiplicateur doit être un entier *isolé* : sans ces deux gardes,
 * « 2,5 x 1L » lirait un lot de 5 (le « 5 » de « 2,5 ») et « 1,5L x 2,5 »
 * un lot de 2.
 */
const COUNT_PREFIX = String.raw`(?<![\d.,])(\d+)`;
const COUNT_SUFFIX = String.raw`(\d+)(?![.,]?\d)`;

/** Signe multiplicateur, éventuellement entre parenthèses : « (x6) ». */
const TIMES = String.raw`\s*\(?\s*[x×*]\s*`;

/**
 * La négation finale `(?![a-zà-ÿ])` est indispensable : sans elle, le « l »
 * de « 1 litre » se retrouverait aussi dans « 1 lessive », et le « g » de
 * « 500 g » dans « 500 gouttes ».
 */
const VOLUME = String.raw`(${NUMBER})\s*(${UNITS})(?![a-zà-ÿ])`;
const QUANTITY_RE = new RegExp(VOLUME, 'gi');

/** « 3 x 1 L », « 2×500 ml », « 4 X 1,5L » — le multiplicateur précède. */
const MULTIPLIED_RE = new RegExp(String.raw`${COUNT_PREFIX}\s*[x×*]\s*${VOLUME}`, 'i');

/** « 1 L x 3 », « 1,36L (x6) » — le multiplicateur suit. */
const MULTIPLIED_SUFFIX_RE = new RegExp(String.raw`${VOLUME}${TIMES}${COUNT_SUFFIX}`, 'i');

const DOSE_UNITS = String.raw`(?:lavages?|doses?|capsules?|tablettes?|pastilles?|sachets?|lingettes?)\b`;

/** « 60 lavages », « 48 doses », « 30 capsules ». */
const DOSES_RE = new RegExp(String.raw`(\d+)\s*${DOSE_UNITS}`, 'gi');

/** « 3 x 40 tablettes », « 3x38 lavages » — un lot de boîtes, pas une boîte. */
const MULTIPLIED_DOSES_RE = new RegExp(String.raw`${COUNT_PREFIX}\s*[x×*]\s*(\d+)\s*${DOSE_UNITS}`, 'i');

/** « 40 capsules x 3 ». */
const MULTIPLIED_DOSES_SUFFIX_RE = new RegExp(String.raw`(\d+)\s*${DOSE_UNITS}${TIMES}${COUNT_SUFFIX}`, 'i');

/** « lot de 3 », « pack de 2 », « paquet de 6 ». */
const PACK_RE = /(?:lot|pack|paquet|set)\s+de\s+(\d+)\b/i;

function toNumber(raw: string): number {
  return Number(raw.replace(',', '.'));
}

/**
 * Les flottants binaires transforment 3 × 0,001 en 0,003000000000000000...
 * Six décimales suffisent à distinguer un millilitre, et rendent deux
 * contenances identiques strictement égales — condition d'un rapprochement.
 */
function round(amount: number): number {
  return Number(amount.toFixed(6));
}

function toQuantity(rawAmount: string, rawUnit: string): Quantity | null {
  const spec = UNIT_FACTORS[rawUnit.toLowerCase()];
  if (!spec) return null;
  const amount = toNumber(rawAmount) * spec.factor;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount: round(amount), unit: spec.unit };
}

function times(quantity: Quantity, count: number): Quantity {
  return { amount: round(quantity.amount * count), unit: quantity.unit };
}

function toCount(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const count = Number(raw);
  return Number.isInteger(count) && count > 0 ? count : null;
}

/**
 * Normalise les espaces exotiques des titres marchands : insécable (U+00A0),
 * insécable fine (U+202F), espace tabulaire (U+2007). Écrits en échappements
 * plutôt qu'en caractères bruts, qu'un éditeur remplace sans prévenir par
 * des espaces ordinaires.
 */
function normalize(title: string): string {
  return title.replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function sameQuantity(a: Quantity, b: Quantity): boolean {
  return a.unit === b.unit && Math.abs(a.amount - b.amount) < 1e-9;
}

interface Multiplied<T> {
  count: number;
  unit: T;
  raw: string;
}

/** Les deux écritures d'un lot de contenances, leurs groupes en ordre inverse. */
function findMultipliedVolume(text: string): Multiplied<Quantity> | null {
  const prefix = MULTIPLIED_RE.exec(text);
  if (prefix) {
    const unit = toQuantity(prefix[2], prefix[3]);
    const count = toCount(prefix[1]);
    if (unit && count) return { count, unit, raw: prefix[0] };
  }
  const suffix = MULTIPLIED_SUFFIX_RE.exec(text);
  if (suffix) {
    const unit = toQuantity(suffix[1], suffix[2]);
    const count = toCount(suffix[3]);
    if (unit && count) return { count, unit, raw: suffix[0] };
  }
  return null;
}

function findMultipliedDoses(text: string): Multiplied<number> | null {
  const prefix = MULTIPLIED_DOSES_RE.exec(text);
  if (prefix) {
    const count = toCount(prefix[1]);
    const unit = toCount(prefix[2]);
    if (count && unit) return { count, unit, raw: prefix[0] };
  }
  const suffix = MULTIPLIED_DOSES_SUFFIX_RE.exec(text);
  if (suffix) {
    const unit = toCount(suffix[1]);
    const count = toCount(suffix[2]);
    if (count && unit) return { count, unit, raw: suffix[0] };
  }
  return null;
}

function distinctVolumes(text: string): Quantity[] {
  const found: Quantity[] = [];
  for (const match of text.matchAll(QUANTITY_RE)) {
    const quantity = toQuantity(match[1], match[2]);
    if (quantity && !found.some((other) => sameQuantity(other, quantity))) found.push(quantity);
  }
  return found;
}

function distinctDoseCounts(text: string): number[] {
  const found = new Set<number>();
  for (const match of text.matchAll(DOSES_RE)) {
    const count = toCount(match[1]);
    if (count) found.add(count);
  }
  return [...found];
}

interface Resolved<T> {
  unit: T | null;
  total: T | null;
  ambiguous: boolean;
}

/**
 * Contenance unitaire et totale.
 *
 * Une contenance seule accompagnée d'un « lot de N » est lue comme celle
 * d'**une** unité (« Le Chat 2L - Lot de 2 » = 2 × 2 L) : le lot est accolé à
 * un nom de produit qui porte déjà sa contenance. C'est la convention des
 * fiches de grande consommation ; le garde-fou d'écart de prix au litre de
 * l'étage de rapprochement rattrapera une fiche qui la contredirait.
 */
function resolveVolume(
  text: string,
  multiplied: Multiplied<Quantity> | null,
  packSize: number | null,
): Resolved<Quantity> {
  const volumes = distinctVolumes(text);

  if (multiplied) {
    const total = times(multiplied.unit, multiplied.count);
    // « 3 x 1L (3L) » est cohérent ; « 3 x 1L + 750 ml » ne l'est pas.
    const stray = volumes.some((v) => !sameQuantity(v, multiplied.unit) && !sameQuantity(v, total));
    return stray ? { unit: null, total: null, ambiguous: true } : { unit: multiplied.unit, total, ambiguous: false };
  }

  if (volumes.length === 0) return { unit: null, total: null, ambiguous: false };
  if (volumes.length === 1) {
    const unit = volumes[0];
    return { unit, total: packSize ? times(unit, packSize) : unit, ambiguous: false };
  }

  // Deux contenances ne se concilient que si l'une est le lot de l'autre :
  // « 2 L - Lot de 2 (4 L) ».
  if (volumes.length === 2 && packSize !== null && packSize > 1) {
    const [small, big] = [...volumes].sort((a, b) => a.amount - b.amount);
    if (sameQuantity(big, times(small, packSize))) return { unit: small, total: big, ambiguous: false };
  }
  return { unit: null, total: null, ambiguous: true };
}

/**
 * Doses unitaires et totales.
 *
 * Plus sévère que la contenance, et pour cause : sur un lot, les titres réels
 * écrivent le nombre de doses tantôt par unité (« Le Chat 2L 40 lavages - Lot
 * de 2 », 40 lavages par bouteille), tantôt pour tout le lot (« Persil 3 x 1L
 * (60 lavages) », vraisemblablement 3 × 20). Un nombre de doses unique sur un
 * lot est donc indécidable, et refusé. Seuls passent l'écriture explicite
 * « 3 x 40 tablettes » et la paire cohérente « 40 lavages … soit 80 lavages ».
 */
function resolveDoses(
  text: string,
  multiplied: Multiplied<number> | null,
  packSize: number | null,
): Resolved<number> {
  const counts = distinctDoseCounts(text);

  if (multiplied) {
    const total = multiplied.unit * multiplied.count;
    const stray = counts.some((c) => c !== multiplied.unit && c !== total);
    return stray ? { unit: null, total: null, ambiguous: true } : { unit: multiplied.unit, total, ambiguous: false };
  }

  if (counts.length === 0) return { unit: null, total: null, ambiguous: false };

  if (packSize === null || packSize === 1) {
    return counts.length === 1
      ? { unit: counts[0], total: counts[0], ambiguous: false }
      : { unit: null, total: null, ambiguous: true };
  }

  if (counts.length === 2) {
    const [small, big] = [...counts].sort((a, b) => a - b);
    if (big === small * packSize) return { unit: small, total: big, ambiguous: false };
  }
  return { unit: null, total: null, ambiguous: true };
}

export function parseQuantity(title: string | null | undefined): ParsedQuantity {
  if (typeof title !== 'string' || title.trim().length === 0) return EMPTY_PARSED_QUANTITY;

  const text = normalize(title);
  const multipliedVolume = findMultipliedVolume(text);
  const multipliedDoses = findMultipliedDoses(text);
  const pack = PACK_RE.exec(text);

  // Un lot peut s'écrire de trois façons à la fois (« Lot de 3 x 1L ») ;
  // elles doivent alors s'accorder. Deux nombres d'unités différents dans le
  // même titre : on ne sait plus ce qui est vendu, on ne retient rien.
  const packSizes = new Set<number>();
  if (multipliedVolume) packSizes.add(multipliedVolume.count);
  if (multipliedDoses) packSizes.add(multipliedDoses.count);
  const declared = toCount(pack?.[1]);
  if (declared) packSizes.add(declared);
  if (packSizes.size > 1) {
    return { ...EMPTY_PARSED_QUANTITY, ambiguous: true, dosesAmbiguous: true };
  }
  const packSize = packSizes.size === 1 ? [...packSizes][0] : null;

  const volume = resolveVolume(text, multipliedVolume, packSize);
  const doses = resolveDoses(text, multipliedDoses, packSize);

  const fragments = [pack?.[0], multipliedVolume?.raw, multipliedDoses?.raw].filter(
    (fragment): fragment is string => fragment !== undefined,
  );

  return {
    quantity: volume.total,
    unitQuantity: volume.unit,
    packSize,
    doses: doses.total,
    unitDoses: doses.unit,
    ambiguous: volume.ambiguous,
    dosesAmbiguous: doses.ambiguous,
    raw: fragments.length > 0 ? fragments.join(' | ') : null,
  };
}

/** Vrai si rien d'exploitable n'a été trouvé — raccourci pour les statistiques. */
export function isEmptyQuantity(parsed: ParsedQuantity): boolean {
  return (
    parsed.quantity === null &&
    parsed.unitQuantity === null &&
    parsed.doses === null &&
    parsed.unitDoses === null
  );
}

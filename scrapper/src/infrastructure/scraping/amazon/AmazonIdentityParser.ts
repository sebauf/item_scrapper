import { normalizeGtin } from '../shared/Gtin.js';

/**
 * Lecture des caractéristiques techniques d'une fiche Amazon — la source
 * d'identité la plus fiable *chez Amazon*.
 *
 * Contrairement aux enseignes qui publient un JSON-LD `Product` complet,
 * Amazon expose son code-barres dans le HTML de la section
 * « Informations sur le produit », sous deux mises en page selon les
 * catégories : une liste à puces (`#detailBullets_feature_div`) et un
 * tableau (`#productDetails_*`). Ce module normalise les deux.
 *
 * Deux pièges propres à Amazon, qui justifient un module dédié :
 *
 * 1. **Les marques directionnelles Unicode.** Les libellés sont réellement
 *    écrits « ASIN‏ : ‎B0CZ1TL7XK ». Ces caractères sont
 *    invisibles mais bien présents : une comparaison naïve de libellé
 *    échoue, et un `Number()` sur la valeur renvoie `NaN`.
 * 2. **Les EAN multiples.** Sur un lot, Amazon liste parfois plusieurs
 *    codes séparés par des espaces. Deux articles distincts se cachent
 *    alors derrière une seule fiche : on refuse d'en choisir un, faute de
 *    quoi le rapprochement désignerait le mauvais produit.
 */

export interface DetailEntry {
  label: string;
  value: string;
}

export interface AmazonIdentity {
  /** GTIN-13 vérifié, ou `null` si absent, invalide ou ambigu. */
  ean: string | null;
  brand: string | null;
  mpn: string | null;
  asin: string | null;
  /** Plusieurs codes-barres distincts sur la fiche : identité indécidable. */
  ambiguousEan: boolean;
  /**
   * Nombre d'unités déclaré par la caractéristique « Nombre d'articles »,
   * `null` s'il est absent, illisible ou déclaré deux fois différemment.
   */
  packSize: number | null;
}

export const EMPTY_IDENTITY: AmazonIdentity = {
  ean: null,
  brand: null,
  mpn: null,
  asin: null,
  ambiguousEan: false,
  packSize: null,
};

/** Marques directionnelles et séparateurs invisibles semés par Amazon. */
const BIDI_MARKS = /[​-‏؜‪-‮⁦-⁩﻿]/g;

const ASIN_RE = /\b([A-Z0-9]{10})\b/;

/**
 * « 3 », « 3,0 », « 3.0 », « 3 unités » — Amazon affiche parfois l'entier en
 * flottant. Toute autre forme (« 1500.0 millilitre ») est écartée : ce n'est
 * plus un nombre d'articles.
 */
const ITEM_COUNT_RE = /^(\d+)(?:[.,]0+)?(?:\s*(?:unites?|articles?|pieces?))?$/i;

function clean(raw: string): string {
  return raw.replace(BIDI_MARKS, '').replace(/\s+/g, ' ').trim();
}

/** Repli des accents : « Numéro » et « Numero » doivent apparier pareil. */
export function normalizeLabel(raw: string): string {
  return clean(raw)
    .replace(/[:：]\s*$/, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Découpe une puce brute « EAN ‏ : ‎3014260610807 » en libellé et valeur.
 *
 * Renvoie `null` quand la puce ne porte pas de séparateur — c'est le cas des
 * lignes décoratives (« Voir les 100 premiers »), qu'il faut écarter sans
 * bruit.
 */
export function splitDetailBullet(raw: string): DetailEntry | null {
  const text = clean(raw);
  const separator = text.indexOf(':');
  if (separator <= 0) return null;

  const label = text.slice(0, separator).trim();
  const value = text.slice(separator + 1).trim();
  if (label.length === 0 || value.length === 0) return null;

  return { label, value };
}

/** Nombre d'articles, ou `null` si la valeur n'en est pas un. */
export function readItemCount(value: string): number | null {
  const folded = clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const match = ITEM_COUNT_RE.exec(folded);
  if (!match) return null;
  const count = Number(match[1]);
  return Number.isInteger(count) && count > 0 ? count : null;
}

/**
 * Tous les GTIN valides d'une valeur, dédoublonnés.
 *
 * Passer par la clé de contrôle plutôt que par la longueur écarte au
 * passage les références fabricant numériques, qui la satisfont rarement.
 */
function readGtins(value: string): string[] {
  const tokens = clean(value).split(/[\s,;/|]+/);
  const found = new Set<string>();
  for (const token of tokens) {
    const gtin = normalizeGtin(token);
    if (gtin !== null) found.add(gtin);
  }
  return [...found];
}

/**
 * Libellés reconnus, **en français et en anglais**.
 *
 * amazon.fr sert ses fiches dans la langue que le navigateur demande. Le
 * scrapper demande le français (`AmazonBrowserLocale`), mais une préférence
 * ignorée suffirait à rendre l'identité illisible : c'est arrivé — 927 fiches
 * sur 927 servies en anglais le 10/11/2026, nombre d'articles lu sur 0 % des
 * fiches alors qu'il était publié sur 92 %. Les libellés anglais ci-dessous
 * sont ceux relevés ce jour-là (`identityDiagnostics.detailLabels`), pas des
 * suppositions.
 */
const LABEL_MATCHERS = {
  // « Global Trade Identification Number » : le code-barres des fiches
  // servies en anglais (30 % des fiches mesurées), sous un nom sans « EAN ».
  ean: (label: string) =>
    /\bean\b/.test(label) || /\bgtin\b/.test(label) || /global trade identification number/.test(label),
  upc: (label: string) => /\bupc\b/.test(label),
  asin: (label: string) => /\basin\b/.test(label),
  brand: (label: string) => /\bmarque\b/.test(label) || /^brand( name)?$/.test(label),
  // Libellé exact : « Référence fabricant », « Manufacturer reference » ou
  // « Manufacturer contact information » contiennent le mot sans désigner
  // la marque.
  manufacturer: (label: string) => /^fabricant$/.test(label) || /^manufacturer$/.test(label),
  // « Nombre d'articles » / « Number of items » seulement. « Nombre d'unités »
  // / « Unit count » est écarté à dessein : Amazon y publie souvent une
  // contenance (« 1500.0 millilitre ») qui sert à son prix unitaire, pas un
  // nombre d'articles.
  itemCount: (label: string) => /^nombre d.articles$/.test(label) || /^number of items$/.test(label),
  // « Model name » (« CrossAction ») est une gamme, pas une référence : exclu.
  mpn: (label: string) =>
    /numero du modele/.test(label) ||
    /reference fabricant/.test(label) ||
    /numero de piece/.test(label) ||
    /^(item )?model number$/.test(label) ||
    /^(item )?part number$/.test(label) ||
    /^manufacturer ?(reference|part ?number)$/.test(label) ||
    /^mpn$/.test(label),
} as const;

/**
 * @param entries caractéristiques relevées sur la fiche, dans l'ordre du
 *   document — les deux mises en page d'Amazon s'y ramènent également
 */
export function parseAmazonDetails(entries: readonly DetailEntry[]): AmazonIdentity {
  const eanCodes = new Set<string>();
  const upcCodes = new Set<string>();
  let brand: string | null = null;
  let manufacturer: string | null = null;
  let mpn: string | null = null;
  let asin: string | null = null;
  const itemCounts = new Set<number | null>();

  for (const entry of entries) {
    const label = normalizeLabel(entry.label);
    const value = clean(entry.value);
    if (value.length === 0) continue;

    if (LABEL_MATCHERS.ean(label)) readGtins(value).forEach((code) => eanCodes.add(code));
    else if (LABEL_MATCHERS.upc(label)) readGtins(value).forEach((code) => upcCodes.add(code));
    else if (LABEL_MATCHERS.asin(label) && asin === null) asin = ASIN_RE.exec(value)?.[1] ?? null;
    else if (LABEL_MATCHERS.itemCount(label)) itemCounts.add(readItemCount(value));
    // La référence passe avant la marque et le fabricant : son libellé les
    // contient souvent, l'ordre inverse la classerait au mauvais endroit.
    else if (LABEL_MATCHERS.mpn(label) && mpn === null) mpn = value;
    else if (LABEL_MATCHERS.brand(label) && brand === null) brand = value;
    else if (LABEL_MATCHERS.manufacturer(label) && manufacturer === null) manufacturer = value;
  }

  // L'EAN prime sur l'UPC : c'est la norme du marché européen, et l'UPC
  // n'apparaît guère que sur les fiches d'import.
  const codes = eanCodes.size > 0 ? eanCodes : upcCodes;
  const ambiguousEan = codes.size > 1;

  return {
    ean: ambiguousEan ? null : ([...codes][0] ?? null),
    // « Fabricant » est un repli acceptable quand « Marque » manque : sur la
    // grande consommation, les deux coïncident presque toujours.
    brand: brand ?? manufacturer,
    mpn,
    asin,
    ambiguousEan,
    // Même règle que l'EAN : deux déclarations différentes, ou une illisible,
    // et l'on ne choisit pas.
    packSize: itemCounts.size === 1 ? [...itemCounts][0] : null,
  };
}

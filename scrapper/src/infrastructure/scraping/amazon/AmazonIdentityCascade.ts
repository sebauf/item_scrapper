import { mergeJsonLdProducts, parseJsonLdProducts, type JsonLdProduct } from '../shared/JsonLdParser.js';
import { EMPTY_PARSED_QUANTITY, parseQuantity, type ParsedQuantity } from '../shared/QuantityParser.js';
import { EMPTY_PACK, reconcilePack, type PackIdentity } from '../shared/PackReconciler.js';
import type { IdentityDiagnostics } from '../../../domain/product/Product.js';
import {
  EMPTY_IDENTITY,
  normalizeLabel,
  parseAmazonDetails,
  type AmazonIdentity,
  type DetailEntry,
} from './AmazonIdentityParser.js';

/**
 * Cascade d'identité pour Amazon — règle pure, sans navigateur : le JSON-LD
 * d'abord s'il porte un GTIN, les caractéristiques ensuite ; pour la marque
 * et la référence, les caractéristiques d'abord.
 *
 * L'ordre n'est pas universel — il est propre à cette enseigne et sera
 * vraisemblablement inverse chez un distributeur alimentaire, dont le
 * JSON-LD est généralement complet. C'est précisément pourquoi chaque
 * boutique garde sa cascade, au-dessus de parseurs partagés.
 */

/** Ce que la page dit d'elle-même, relevé pour le diagnostic. */
export interface PageSignals {
  detailContainers: string[];
  mentionsEan: boolean;
  mentionsItemCount: boolean;
}

export const NO_SIGNALS: PageSignals = Object.freeze({
  detailContainers: [],
  mentionsEan: false,
  mentionsItemCount: false,
});

/** Le brut lu dans la page par `AmazonIdentityExtractor`. */
export interface IdentitySources {
  /** Blocs `application/ld+json`, non vides. */
  jsonLdScripts: string[];
  /** Caractéristiques, puces et tableaux confondus, dans l'ordre du document. */
  detailEntries: DetailEntry[];
  signals: PageSignals;
}

export interface ExtractedIdentity extends AmazonIdentity {
  /** Ce que le JSON-LD de la page a donné, `null` s'il n'en publie aucun. */
  jsonLd: JsonLdProduct | null;
  /** Nombre de blocs `application/ld+json` présents, publiant un produit ou non. */
  jsonLdScriptCount: number;
  /** Ce que le titre seul dit du conditionnement — conservé pour la mesure. */
  quantity: ParsedQuantity;
  /** Conditionnement retenu : titre croisé avec « Nombre d'articles ». */
  pack: PackIdentity;
  /** D'où vient l'EAN finalement retenu — mesure clé du spike. */
  eanSource: 'json-ld' | 'details' | null;
  /** Traces de l'extraction, enregistrées avec le relevé. */
  diagnostics: IdentityDiagnostics;
}

export const EMPTY_DIAGNOSTICS: IdentityDiagnostics = Object.freeze({
  eanSource: null,
  jsonLdProduct: false,
  detailEntries: 0,
  detailLabels: [],
  ...NO_SIGNALS,
  declaredPackSize: null,
  packIssue: null,
});

/** Identité d'une page qu'on n'a pas pu lire (échec définitif de la requête). */
export const EMPTY_EXTRACTED_IDENTITY: ExtractedIdentity = Object.freeze({
  ...EMPTY_IDENTITY,
  eanSource: null,
  jsonLd: null,
  jsonLdScriptCount: 0,
  quantity: EMPTY_PARSED_QUANTITY,
  pack: EMPTY_PACK,
  diagnostics: EMPTY_DIAGNOSTICS,
});

/** Plafonds : le diagnostic ne doit pas faire grossir `items_raw` sans borne. */
const MAX_LABELS = 40;
const MAX_LABEL_LENGTH = 60;

export function resolveAmazonIdentity(sources: IdentitySources, title: string): ExtractedIdentity {
  const { jsonLdScripts, detailEntries, signals } = sources;
  const jsonLd = mergeJsonLdProducts(parseJsonLdProducts(jsonLdScripts));
  const details = detailEntries.length > 0 ? parseAmazonDetails(detailEntries) : EMPTY_IDENTITY;

  const quantity = parseQuantity(title);
  const pack = reconcilePack(quantity, details.packSize);
  const ean = jsonLd?.gtin ?? details.ean;
  const eanSource = jsonLd?.gtin ? 'json-ld' : details.ean ? 'details' : null;

  return {
    ean,
    eanSource,
    brand: details.brand ?? jsonLd?.brand ?? null,
    mpn: details.mpn ?? jsonLd?.mpn ?? null,
    asin: details.asin,
    ambiguousEan: details.ambiguousEan,
    packSize: details.packSize,
    jsonLd,
    jsonLdScriptCount: jsonLdScripts.length,
    quantity,
    pack,
    diagnostics: {
      eanSource,
      jsonLdProduct: jsonLd !== null,
      detailEntries: detailEntries.length,
      detailLabels: summarizeLabels(detailEntries),
      ...signals,
      declaredPackSize: details.packSize,
      packIssue: pack.issue,
    },
  };
}

/** Libellés normalisés, dédoublonnés, bornés en nombre et en longueur. */
export function summarizeLabels(entries: readonly DetailEntry[]): string[] {
  const labels = new Set<string>();
  for (const entry of entries) {
    const label = normalizeLabel(entry.label).slice(0, MAX_LABEL_LENGTH);
    if (label.length > 0) labels.add(label);
    if (labels.size >= MAX_LABELS) break;
  }
  return [...labels];
}

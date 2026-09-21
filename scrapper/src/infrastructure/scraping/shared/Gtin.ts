/**
 * Normalisation et validation des codes-barres (GTIN / EAN).
 *
 * Pourquoi valider plutôt que faire confiance : un EAN est *la* clé de
 * rapprochement entre enseignes. Un code mal extrait — une référence
 * fabricant prise pour un EAN, un chiffre avalé par un caractère invisible —
 * produirait un faux rapprochement, c'est-à-dire exactement l'erreur que la
 * comparaison stricte doit rendre impossible.
 *
 * La clé de contrôle GTIN coûte trois lignes et écarte ~90 % des
 * mauvaises extractions : une suite de 13 chiffres tirée au hasard n'a
 * qu'une chance sur dix de la satisfaire. C'est le premier garde-fou de la
 * chaîne, et le moins cher.
 *
 * Les longueurs acceptées sont celles de la famille GTIN : 8 (EAN-8),
 * 12 (UPC-A, courant sur les fiches Amazon d'import), 13 (EAN-13, la norme
 * européenne) et 14 (GTIN-14, carton de regroupement). Toutes sont ramenées
 * à 13 chiffres quand c'est possible sans perte, pour qu'un UPC relevé chez
 * une enseigne et l'EAN correspondant relevé chez une autre se rapprochent
 * au lieu de rester étrangers.
 */

const DIGITS_ONLY = /^\d+$/;
const ACCEPTED_LENGTHS = [8, 12, 13, 14];

/**
 * Retire tout ce qui n'est pas un chiffre : espaces, tirets, et surtout les
 * marques directionnelles Unicode (U+200E / U+200F) qu'Amazon insère dans
 * ses libellés de caractéristiques. Sans ce nettoyage, `Number.isNaN` ne
 * suffit pas : la chaîne « 3014260610807 » encadrée de marques invisibles
 * n'est pas égale à elle-même en comparaison brute.
 */
function keepDigits(raw: string): string {
  return raw.replace(/\D/g, '');
}

/** Clé de contrôle GTIN : pondération 3/1 alternée depuis la droite. */
export function hasValidGtinChecksum(digits: string): boolean {
  if (!DIGITS_ONLY.test(digits) || digits.length < 8) return false;

  const values = digits.split('').map(Number);
  const check = values[values.length - 1];
  const body = values.slice(0, -1);

  let sum = 0;
  let weight = 3;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += body[i] * weight;
    weight = weight === 3 ? 1 : 3;
  }

  return (10 - (sum % 10)) % 10 === check;
}

/**
 * Ramène un GTIN à sa forme canonique sur 13 chiffres, ou `null` si la
 * valeur n'est pas un code-barres plausible.
 *
 * - UPC-12 → préfixé d'un zéro, ce qui *est* l'EAN-13 correspondant ;
 * - GTIN-14 → le premier chiffre est l'indicateur de regroupement ; on ne le
 *   retire que s'il vaut zéro, auquel cas le code désigne bien l'unité
 *   consommateur. Un carton de 6 (indicateur ≠ 0) n'est pas le même article
 *   que l'unité : on le rejette plutôt que de le confondre ;
 * - EAN-8 → conservé tel quel, il n'a pas d'équivalent 13 chiffres.
 */
export function normalizeGtin(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;

  const digits = keepDigits(String(raw));
  if (!ACCEPTED_LENGTHS.includes(digits.length)) return null;
  if (!hasValidGtinChecksum(digits)) return null;

  if (digits.length === 12) return `0${digits}`;
  if (digits.length === 14) return digits.startsWith('0') ? digits.slice(1) : null;
  return digits;
}

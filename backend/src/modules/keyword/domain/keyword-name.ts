import { InvalidKeywordName } from './keyword.errors';

/**
 * Objet-valeur : un nom de mot-clé valide.
 *
 * Intérêt d'en faire un type plutôt qu'un `string` : une fois qu'on tient une
 * `KeywordName`, il est *impossible* qu'elle soit vide, non trimée ou trop
 * longue. La validation n'a lieu qu'ici, et le reste du code n'a plus jamais à
 * se demander si la valeur est propre.
 *
 * Immuable et sans identité : deux KeywordName de même valeur sont
 * interchangeables — d'où `equals` plutôt qu'une comparaison de références.
 */
export class KeywordName {
  static readonly MAX_LENGTH = 100;

  private constructor(readonly value: string) {}

  static create(raw: unknown): KeywordName {
    if (typeof raw !== 'string') {
      throw new InvalidKeywordName('Le mot-clé doit être une chaîne de caractères.');
    }

    const trimmed = raw.trim();

    if (trimmed.length === 0) {
      throw new InvalidKeywordName('Le mot-clé ne peut pas être vide.');
    }
    if (trimmed.length > KeywordName.MAX_LENGTH) {
      throw new InvalidKeywordName(
        `Le mot-clé est trop long (max ${KeywordName.MAX_LENGTH} caractères).`,
      );
    }

    return new KeywordName(trimmed);
  }

  equals(other: KeywordName): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

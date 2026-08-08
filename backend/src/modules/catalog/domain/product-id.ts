import { InvalidProductId } from './catalog.errors';

const MAX_ENCODED_LENGTH = 2048;
const BASE64URL_ALPHABET = /^[A-Za-z0-9_-]+$/;

/**
 * Identité d'un produit, sous ses deux formes.
 *
 * En base, un produit est identifié par son URL (`_id` de `price_history` et de
 * `deal_scores`). Une URL ne peut pas voyager telle quelle dans un chemin HTTP :
 * ses `/` et ses `%2F` sont réécrits par certains reverses proxies. D'où la
 * forme encodée en base64url, dont l'alphabet [A-Za-z0-9_-] traverse n'importe
 * quel proxy sans dommage.
 *
 * Reprend frontend/src/lib/encoding.ts, à ceci près que l'encodage remonte
 * désormais dans l'API : chaque produit renvoyé porte son `id` déjà encodé, le
 * frontend n'a plus qu'à le recopier dans ses liens. Une duplication de logique
 * en moins.
 */
export class ProductId {
  private constructor(
    /** URL canonique du produit — la clé réelle en base. */
    readonly url: string,
    /** Forme encodée, utilisée dans les chemins HTTP. */
    readonly value: string,
  ) {}

  static fromUrl(url: string): ProductId {
    return new ProductId(url, Buffer.from(url, 'utf8').toString('base64url'));
  }

  static fromEncoded(encoded: unknown): ProductId {
    if (typeof encoded !== 'string' || encoded.length === 0) {
      throw new InvalidProductId('identifiant absent.');
    }
    if (encoded.length > MAX_ENCODED_LENGTH) {
      throw new InvalidProductId(`plus de ${MAX_ENCODED_LENGTH} caractères.`);
    }
    if (!BASE64URL_ALPHABET.test(encoded)) {
      throw new InvalidProductId('caractères hors alphabet base64url.');
    }

    const url = Buffer.from(encoded, 'base64url').toString('utf8');

    // Buffer.from est permissif : il ne lève pas sur une entrée mal formée, il
    // tronque. Le seul contrôle fiable est de vérifier que le ré-encodage
    // redonne exactement l'entrée.
    if (Buffer.from(url, 'utf8').toString('base64url') !== encoded) {
      throw new InvalidProductId('encodage base64url mal formé.');
    }
    if (!/^https?:\/\//.test(url)) {
      throw new InvalidProductId("la valeur décodée n'est pas une URL http(s).");
    }

    return new ProductId(url, encoded);
  }

  equals(other: ProductId): boolean {
    return this.url === other.url;
  }
}

/**
 * Port vers le registre d'images (GHCR).
 *
 * Ne lève jamais : un registre injoignable rend l'état d'un composant
 * « inconnu », il ne doit pas faire tomber la page qui l'affiche.
 */
export abstract class ImageRegistry {
  /** Digest vers lequel pointe aujourd'hui la référence `image`, ou `null`. */
  abstract latestDigest(image: string): Promise<string | null>;
}

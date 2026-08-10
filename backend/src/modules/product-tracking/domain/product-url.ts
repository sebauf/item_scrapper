import { InvalidProductUrl } from './product-tracking.errors';

const ASIN_PATTERN = /\/dp\/([A-Z0-9]{10})/i;

/**
 * Objet-valeur : une URL de produit Amazon suivable individuellement.
 *
 * Le seul crawler existant est Amazon (cf. `scrapper/src/infrastructure/
 * scraping/amazon/`) : accepter n'importe quelle autre URL ne remonterait
 * jamais de données, silencieusement, jusqu'au prochain scrape. On refuse
 * donc à la saisie plutôt qu'à l'usage.
 *
 * Canonicalisation vers `https://www.amazon.fr/dp/ASIN/` — même forme que
 * `AmazonSearchHandler`/`AmazonCrawler` normalisent déjà côté scrapper — pour
 * qu'une URL collée à la main fusionne son historique avec le même produit
 * trouvé via une recherche par mot-clé, plutôt que d'en ouvrir un second sous
 * une variante d'URL (paramètres de tracking, préfixe `/gp/product/`, etc).
 */
export class ProductUrl {
  private constructor(readonly value: string) {}

  static create(raw: unknown): ProductUrl {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      throw new InvalidProductUrl('l’URL doit être une chaîne non vide.');
    }

    let parsed: URL;
    try {
      parsed = new URL(raw.trim());
    } catch {
      throw new InvalidProductUrl("l'URL est mal formée.");
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new InvalidProductUrl('seules les URLs http(s) sont acceptées.');
    }
    if (parsed.hostname !== 'amazon.fr' && parsed.hostname !== 'www.amazon.fr') {
      throw new InvalidProductUrl('seules les URLs amazon.fr sont suivies pour le moment.');
    }

    const match = ASIN_PATTERN.exec(parsed.pathname);
    if (!match) {
      throw new InvalidProductUrl("l'URL ne pointe pas vers une fiche produit (/dp/ASIN).");
    }

    return new ProductUrl(`https://www.amazon.fr/dp/${match[1].toUpperCase()}/`);
  }

  equals(other: ProductUrl): boolean {
    return this.value === other.value;
  }
}

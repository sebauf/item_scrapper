/**
 * Règles pures sur les URL amazon.fr : reconnaître une fiche produit et son
 * ASIN, et distinguer une fiche disparue d'une page de blocage.
 */

export const AMAZON_ORIGIN = 'https://www.amazon.fr';

/** `/dp/<ASIN>` : le chemin d'une fiche ; un ASIN fait 10 caractères. */
const PRODUCT_PATH = /\/dp\/([A-Z0-9]{10})/i;

/**
 * Pages qu'Amazon sert à la place d'une fiche quand il soupçonne un robot
 * (captcha, connexion forcée). La fiche existe toujours : y être redirigé ne
 * dit rien de l'article.
 */
const BLOCK_PATH_FRAGMENTS = ['/errors/validateCaptcha', '/ap/signin', '/ap/cvf'];

/** URL canonique d'une fiche : sans titre ni paramètres de suivi. */
export function productUrl(asin: string): string {
  return `${AMAZON_ORIGIN}/dp/${asin}/`;
}

export function asinOf(url: string): string | null {
  return PRODUCT_PATH.exec(url)?.[1] ?? null;
}

/**
 * Fiches des autres déclinaisons, dans l'ordre de la page : les ASIN annoncés
 * (`data-asin`), puis ceux des liens (`data-dp-url`), sans doublon ni la fiche
 * courante.
 */
export function variantUrls(dataAsins: readonly string[], dpUrls: readonly string[], currentAsin: string | null): string[] {
  const asins = new Set(dataAsins.filter((asin) => asin.length > 0));
  for (const url of dpUrls) {
    const asin = asinOf(url);
    if (asin) asins.add(asin);
  }
  if (currentAsin) asins.delete(currentAsin);
  return [...asins].map(productUrl);
}

/** Un lien relatif de la page (`/s?k=…&page=2`) devient absolu. */
export function absoluteUrl(href: string): string {
  return href.startsWith('http') ? href : `${AMAZON_ORIGIN}${href}`;
}

export function isBlockPage(url: string): boolean {
  return BLOCK_PATH_FRAGMENTS.some((fragment) => url.includes(fragment));
}

/**
 * Une fiche demandée qui aboutit ailleurs que sur une fiche (accueil,
 * recherche) n'existe plus. Une redirection vers une page de blocage, elle,
 * ne prouve rien.
 */
export function isDeadProductRedirect(requestedUrl: string, finalUrl: string): boolean {
  return PRODUCT_PATH.test(requestedUrl) && !PRODUCT_PATH.test(finalUrl) && !isBlockPage(finalUrl);
}

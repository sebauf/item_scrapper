import type { Page } from 'playwright';

/**
 * Langue dans laquelle le scrapper demande les fiches amazon.fr : le français.
 *
 * Sans réglage, l'empreinte de navigateur générée par Crawlee annonce
 * `en-US` (valeur par défaut de son générateur), et amazon.fr suit cette
 * préférence : titres traduits (« Dishwasher Tablets, 1 Pack of 24
 * Tablets »), caractéristiques en anglais (« number of items », « brand
 * name », « global trade identification number »). Mesuré le 10/11/2026 sur
 * 927 fiches : tous les libellés lus étaient anglais, si bien que le parseur
 * d'identité, écrit pour des libellés français, ne lisait ni le nombre
 * d'articles (publié sur 92 % des fiches) ni la marque, et ratait le
 * code-barres sur 30 % des fiches.
 *
 * Le français est demandé deux fois, parce qu'aucun des deux réglages n'est
 * garanti seul : la langue de l'empreinte (cohérente avec `navigator.language`
 * — une empreinte qui contredirait l'en-tête serait un signal de robot) et
 * l'en-tête `Accept-Language` de chaque requête. Les parseurs, eux, restent
 * bilingues : si Amazon servait malgré tout de l'anglais, l'identité serait
 * lue quand même, et les traces d'extraction le montreraient.
 */
export const AMAZON_LOCALES = ['fr-FR', 'fr'];

export const AMAZON_ACCEPT_LANGUAGE = 'fr-FR,fr;q=0.9';

/** À passer à `browserPoolOptions` de tout `PlaywrightCrawler` visant amazon.fr. */
export const AMAZON_BROWSER_POOL_OPTIONS = {
  useFingerprints: true,
  fingerprintOptions: {
    fingerprintGeneratorOptions: { locales: AMAZON_LOCALES },
  },
};

/** `preNavigationHook` : impose l'en-tête de langue avant chaque navigation. */
export async function requestFrenchPages({ page }: { page: Page }): Promise<void> {
  await page.setExtraHTTPHeaders({ 'Accept-Language': AMAZON_ACCEPT_LANGUAGE });
}

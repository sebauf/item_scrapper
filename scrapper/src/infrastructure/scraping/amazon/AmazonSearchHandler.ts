import type { PlaywrightCrawlingContext } from 'crawlee';
import { AMAZON_ORIGIN, absoluteUrl, asinOf, productUrl } from './AmazonUrl.js';

export const SEARCH_LABEL = 'SEARCH';

/**
 * Label des fiches trouvées en recherche. Aucune route ne lui est dédiée : le
 * routeur de Crawlee envoie un label inconnu au handler par défaut, celui de
 * toutes les fiches. Il ne sert qu'à reconnaître ces requêtes dans la file.
 */
const PRODUCT_LABEL = 'PRODUCT';

/** Pages de résultats lues par mot-clé ; compte dans le budget par mot-clé (cf. AmazonCrawler). */
const MAX_SEARCH_PAGES = 5;

const SEARCH_RESULT_SELECTOR = 'div[data-component-type="s-search-result"]';
const RESULT_PRODUCT_LINK_SELECTOR = `${SEARCH_RESULT_SELECTOR} a.a-link-normal[href*="/dp/"]`;
const NEXT_PAGE_SELECTOR = 'a.s-pagination-next';
const SEARCH_RESULTS_TIMEOUT_MS = 15_000;

export function searchUrl(keyword: string): string {
  return `${AMAZON_ORIGIN}/s?k=${encodeURIComponent(keyword)}`;
}

export async function amazonSearchHandler({
  page,
  request,
  enqueueLinks,
  log,
}: PlaywrightCrawlingContext): Promise<void> {
  const { keyword, page: pageNum = 1 } = request.userData as { keyword: string; page?: number };

  // Sans résultat dans le délai (recherche vide, blocage), on enfile ce que
  // la page contient — rien, le plus souvent — plutôt que d'échouer.
  await page.waitForSelector(SEARCH_RESULT_SELECTOR, { timeout: SEARCH_RESULTS_TIMEOUT_MS }).catch(() => {});

  await enqueueLinks({
    selector: RESULT_PRODUCT_LINK_SELECTOR,
    label: PRODUCT_LABEL,
    userData: { keyword },
    transformRequestFunction: (req) => {
      const asin = asinOf(req.url);
      if (asin) req.url = productUrl(asin);
      return req;
    },
  });

  if (pageNum < MAX_SEARCH_PAGES) {
    const nextHref = await page
      .$eval(NEXT_PAGE_SELECTOR, (el) => el.getAttribute('href'))
      .catch(() => null);
    if (nextHref) {
      await enqueueLinks({
        urls: [absoluteUrl(nextHref)],
        label: SEARCH_LABEL,
        userData: { keyword, page: pageNum + 1 },
      });
    }
  }

  log.info(`Search page ${pageNum} for "${keyword}" processed`);
}

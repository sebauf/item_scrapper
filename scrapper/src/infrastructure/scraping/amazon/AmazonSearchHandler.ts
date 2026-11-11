import type { PlaywrightCrawlingContext } from 'crawlee';
import type { ScrapeFailureRecorder } from '../shared/ScrapeFailureRecorder.js';
import { SEARCH_RESULT_SELECTOR } from './AmazonPageEvidence.js';
import { diagnoseOrRetry, recordUnreadablePage } from './AmazonUnreadablePage.js';

const MAX_SEARCH_PAGES = 5;

export function createAmazonSearchHandler(
  failures: ScrapeFailureRecorder,
): (context: PlaywrightCrawlingContext) => Promise<void> {
  return (context) => handleSearchPage(context, failures);
}

async function handleSearchPage(
  context: PlaywrightCrawlingContext,
  failures: ScrapeFailureRecorder,
): Promise<void> {
  const { page, request, enqueueLinks, log } = context;
  const { keyword, page: pageNum = 1 } = request.userData as { keyword: string; page?: number };

  await page.waitForSelector(SEARCH_RESULT_SELECTOR, { timeout: 15000 }).catch(() => {});

  // Une recherche sans résultat lisible n'est plus « traitée » en silence :
  // un captcha à cet endroit privait le mot-clé de tous ses nouveaux produits
  // pour la journée.
  const resultCount = await page.locator(SEARCH_RESULT_SELECTOR).count().catch(() => 0);
  if (resultCount === 0) {
    const unreadable = await diagnoseOrRetry(context, 'search');
    await recordUnreadablePage(failures, context, 'search', unreadable, 'skipped');
    return;
  }

  await enqueueLinks({
    selector: `${SEARCH_RESULT_SELECTOR} a.a-link-normal[href*="/dp/"]`,
    label: 'PRODUCT',
    userData: { keyword },
    transformRequestFunction: (req) => {
      const match = req.url.match(/\/dp\/([A-Z0-9]{10})/);
      if (match) req.url = `https://www.amazon.fr/dp/${match[1]}/`;
      return req;
    },
  });

  if (pageNum < MAX_SEARCH_PAGES) {
    const nextHref = await page
      .$eval('a.s-pagination-next', (el) => el.getAttribute('href'))
      .catch(() => null);
    if (nextHref) {
      const nextUrl = nextHref.startsWith('http') ? nextHref : `https://www.amazon.fr${nextHref}`;
      await enqueueLinks({
        urls: [nextUrl],
        label: 'SEARCH',
        userData: { keyword, page: pageNum + 1 },
      });
    }
  }

  log.info(`Search page ${pageNum} for "${keyword}" processed (${resultCount} results)`);
}

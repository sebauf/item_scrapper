import type { PlaywrightCrawlingContext } from 'crawlee';

const MAX_SEARCH_PAGES = 5;

export async function amazonSearchHandler({
  page,
  request,
  enqueueLinks,
  log,
}: PlaywrightCrawlingContext): Promise<void> {
  const { keyword, page: pageNum = 1 } = request.userData as { keyword: string; page?: number };

  await page
    .waitForSelector('div[data-component-type="s-search-result"]', { timeout: 15000 })
    .catch(() => {});

  await enqueueLinks({
    selector: 'div[data-component-type="s-search-result"] a.a-link-normal[href*="/dp/"]',
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

  log.info(`Search page ${pageNum} for "${keyword}" processed`);
}

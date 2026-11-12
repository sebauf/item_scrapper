import 'dotenv/config';
import { PlaywrightCrawler, createPlaywrightRouter } from 'crawlee';
import { MongoConnection } from '../infrastructure/persistence/mongodb/MongoConnection.js';
import { MongoProductRepository } from '../infrastructure/persistence/mongodb/MongoProductRepository.js';
import { createAmazonProductHandler } from '../infrastructure/scraping/amazon/AmazonProductHandler.js';
import {
  AMAZON_BROWSER_POOL_OPTIONS,
  requestFrenchPages,
} from '../infrastructure/scraping/amazon/AmazonBrowserLocale.js';

const TARGET_URL = 'https://www.amazon.fr/dp/B0GNSHRHV2/';

async function main(): Promise<void> {

  const connection = await MongoConnection.fromEnv();

  try {
    const productRepository = new MongoProductRepository(connection.db);
    const router = createPlaywrightRouter();
    router.addDefaultHandler(createAmazonProductHandler(productRepository));

    const crawler = new PlaywrightCrawler({
      maxRequestsPerCrawl: 10,
      maxConcurrency: 1,
      requestHandler: router,
      browserPoolOptions: AMAZON_BROWSER_POOL_OPTIONS,
      preNavigationHooks: [requestFrenchPages],
      launchContext: {
        launchOptions: {
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
        },
      },
    });

    await crawler.run([{ url: TARGET_URL, userData: { keyword: 'verify-variants' } }]);
  } finally {
    await connection.disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

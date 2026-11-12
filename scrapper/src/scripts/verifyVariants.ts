import 'dotenv/config';
import { PlaywrightCrawler, createPlaywrightRouter } from 'crawlee';
import { MongoConnection } from '../infrastructure/persistence/mongodb/MongoConnection.js';
import { MongoProductRepository } from '../infrastructure/persistence/mongodb/MongoProductRepository.js';
import { createAmazonProductHandler } from '../infrastructure/scraping/amazon/AmazonProductHandler.js';
import { AMAZON_CRAWLER_OPTIONS } from '../infrastructure/scraping/amazon/AmazonCrawlerOptions.js';

/**
 * Rejoue le handler produit sur une seule fiche (et ses déclinaisons), avec
 * les réglages du scrape : utile pour mettre au point un sélecteur sans lancer
 * un crawl complet. Écrit en base comme le scrape, sous le mot-clé
 * `verify-variants`.
 */
const TARGET_URL = 'https://www.amazon.fr/dp/B0GNSHRHV2/';

async function main(): Promise<void> {
  const connection = await MongoConnection.fromEnv();

  try {
    const productRepository = new MongoProductRepository(connection.db);
    const router = createPlaywrightRouter();
    router.addDefaultHandler(createAmazonProductHandler(productRepository));

    const crawler = new PlaywrightCrawler({
      ...AMAZON_CRAWLER_OPTIONS,
      maxRequestsPerCrawl: 10,
      maxConcurrency: 1,
      requestHandler: router,
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

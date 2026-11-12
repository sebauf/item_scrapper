import 'dotenv/config';
import { MongoConnection } from './infrastructure/persistence/mongodb/MongoConnection.js';
import { MongoProductRepository } from './infrastructure/persistence/mongodb/MongoProductRepository.js';
import { MongoKeywordRepository } from './infrastructure/persistence/mongodb/MongoKeywordRepository.js';
import { MongoTrackedUrlRepository } from './infrastructure/persistence/mongodb/MongoTrackedUrlRepository.js';
import {
  AmazonCrawler,
  DEFAULT_MAX_REQUESTS_PER_CRAWL,
} from './infrastructure/scraping/amazon/AmazonCrawler.js';
import { ScrapeProductsUseCase } from './application/ScrapeProductsUseCase.js';
import { SeedKeywordsUseCase } from './application/SeedKeywordsUseCase.js';
import { createKeyword } from './domain/keyword/Keyword.js';

const DEFAULT_KEYWORDS = ['lessive liquide', 'adoucissant', 'liquide de rincage finish'].map(
  createKeyword,
);

async function main(): Promise<void> {
  const maxRequestsPerCrawl = parseInt(
    process.env.MAX_REQUESTS_PER_CRAWL ?? String(DEFAULT_MAX_REQUESTS_PER_CRAWL),
    10,
  );
  const connection = await MongoConnection.fromEnv();

  try {
    const productRepository = new MongoProductRepository(connection.db);
    const keywordRepository = new MongoKeywordRepository(connection.db);
    const trackedUrlRepository = new MongoTrackedUrlRepository(connection.db);
    const shopScraper = new AmazonCrawler(productRepository, maxRequestsPerCrawl);

    await new SeedKeywordsUseCase(keywordRepository).execute(DEFAULT_KEYWORDS);
    await new ScrapeProductsUseCase(keywordRepository, trackedUrlRepository, shopScraper).execute();
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

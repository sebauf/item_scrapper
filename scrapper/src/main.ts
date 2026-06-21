import 'dotenv/config';
import { MongoConnection } from './infrastructure/persistence/mongodb/MongoConnection.js';
import { MongoProductRepository } from './infrastructure/persistence/mongodb/MongoProductRepository.js';
import { MongoKeywordRepository } from './infrastructure/persistence/mongodb/MongoKeywordRepository.js';
import { AmazonCrawler } from './infrastructure/scraping/amazon/AmazonCrawler.js';
import { ScrapeProductsUseCase } from './application/ScrapeProductsUseCase.js';
import { SeedKeywordsUseCase } from './application/SeedKeywordsUseCase.js';
import { createKeyword } from './domain/keyword/Keyword.js';

const DEFAULT_KEYWORDS = ['lessive liquide', 'adoucissant', 'liquide de rincage finish'].map(
  createKeyword,
);

async function main(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGODB_URI is not defined');

  const connection = new MongoConnection();
  await connection.connect(mongoUri);

  try {
    const productRepository = new MongoProductRepository(connection.db);
    const keywordRepository = new MongoKeywordRepository(connection.db);
    const shopScraper = new AmazonCrawler(productRepository);

    await new SeedKeywordsUseCase(keywordRepository).execute(DEFAULT_KEYWORDS);
    await new ScrapeProductsUseCase(keywordRepository, shopScraper).execute();
  } finally {
    await connection.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

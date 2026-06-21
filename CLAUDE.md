# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

- **Scrapper** (`scrapper/`): Node.js + TypeScript, clean architecture (domain / application / infrastructure), [Crawlee](https://crawlee.dev/) with `PlaywrightCrawler`, MongoDB driver v6
- **Frontend** (`frontend/`): Next.js 15, React 19, Tailwind CSS v4, MongoDB driver v6 (reads directly from DB)
- **Infrastructure** (`infra/`): MongoDB 7 in Docker with a named volume for persistence

## Commands

### Infrastructure

```bash
cd infra
docker compose up -d       # start MongoDB
docker compose down        # stop
docker compose down -v     # stop + delete volume (destructive)
```

### Scrapper

```bash
cd scrapper
npm install
npx playwright install chromium   # first-time setup only
cp .env.example .env               # then edit .env if needed
npm run start                      # run the scraper (tsx)
npm run build                      # compile to dist/
npm run start:prod                 # run compiled output
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env               # set MONGODB_URI
npm run dev                        # dev server on :3000
npm run build && npm run start     # production
```

The frontend has a Dockerfile for containerised deployment.

## Architecture

### Scrapper — clean architecture

```
domain/          — entities (Keyword, Product) + repository interfaces
application/     — use cases (ScrapeProductsUseCase, SeedKeywordsUseCase) + port IShopScraper
infrastructure/  — MongoDB repositories, AmazonCrawler + handlers
```

Data flow: `main.ts` → seed default keywords → `ScrapeProductsUseCase` → `IShopScraper.scrape(keywords)` → `AmazonCrawler` runs a search + product pages via Crawlee → results upserted in MongoDB via `MongoProductRepository`.

### Key scrapper files

- `src/main.ts` — entry point: MongoDB connection, use-case wiring, default keywords
- `src/application/ScrapeProductsUseCase.ts` — fetches enabled keywords, delegates to scraper
- `src/application/SeedKeywordsUseCase.ts` — seeds missing keywords into DB
- `src/infrastructure/scraping/amazon/AmazonCrawler.ts` — configures `PlaywrightCrawler`, routes search vs product pages
- `src/infrastructure/scraping/amazon/AmazonSearchHandler.ts` — enqueues product URLs from search results
- `src/infrastructure/scraping/amazon/AmazonProductHandler.ts` — extracts title, price, images from a product page
- `src/infrastructure/scraping/amazon/PriceParser.ts` — normalises Amazon price strings
- `src/infrastructure/persistence/mongodb/MongoProductRepository.ts` — upserts products by URL + day
- `src/infrastructure/persistence/mongodb/MongoKeywordRepository.ts` — CRUD for keywords
- `src/infrastructure/persistence/mongodb/MongoConnection.ts` — singleton `MongoClient`

### Key frontend files

- `src/app/page.tsx` — home: lists tracked keywords with product count + last scrape date
- `src/app/keyword/[slug]/page.tsx` — keyword detail: product grid with price, crossed-out price, unit price, discount %, delivery date
- `src/lib/mongodb.ts` — shared `MongoClient` singleton for Next.js
- `src/types/product.ts` — `Product` and `KeywordSummary` types

### MongoDB

- DB: `scrapper`, collection: `items_raw`
- Documents have: `url`, `keyword`, `title`, `price`, `crossedOutPrice`, `unitPrice`, `images`, `deliveryDate`, `day`, `scrapedAt`
- Upsert by `(url, day)` → re-runs update existing items without duplicates
- URI configured in `.env` via `MONGODB_URI`

### Adding a crawler for a new shop

1. Create `src/domain/product/` interfaces if the data model changes
2. Create `src/infrastructure/scraping/<shop>/` — implement `IShopScraper`
3. Import and instantiate in `src/main.ts`

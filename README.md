# Item Scrapper

Price tracker that scrapes Amazon product pages by keyword and displays results in a web UI.

## Architecture

```
infra/       — MongoDB 7 (Docker)
scrapper/    — Node.js scraper (Crawlee + Playwright)
frontend/    — Next.js 15 dashboard
```

The scraper runs on demand, stores results in MongoDB, and the Next.js frontend reads directly from the database.

## Quick start

### 1. Start MongoDB

```bash
cd infra
docker compose up -d
```

### 2. Run the scraper

```bash
cd scrapper
npm install
npx playwright install chromium   # first time only
cp .env.example .env
npm run start
```

Default keywords: `lessive liquide`, `adoucissant`, `liquide de rincage finish`.

### 3. Start the frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Stack

| Layer | Technology |
|---|---|
| Scraper | Node.js, TypeScript, Crawlee, Playwright |
| Storage | MongoDB 7 |
| Frontend | Next.js 15, React 19, Tailwind CSS v4 |
| Infrastructure | Docker Compose |

## Configuration

Both `scrapper/` and `frontend/` use a `.env` file with a single variable:

```
MONGODB_URI=mongodb://admin:password@localhost:27017/scrapper?authSource=admin
```

The scraper also supports `MAX_REQUESTS_PER_CRAWL` (default: 200).

## Scrapper architecture

The scraper follows clean architecture:

- **Domain** — `Keyword` and `Product` entities, repository interfaces
- **Application** — `SeedKeywordsUseCase`, `ScrapeProductsUseCase`
- **Infrastructure** — MongoDB repositories, `AmazonCrawler` (search → product pages)

### Adding a new shop

1. Create `src/infrastructure/scraping/<shop>/` and implement `IShopScraper`
2. Import and wire it in `src/main.ts`

## Frontend

The dashboard lists tracked keywords on the home page. Clicking a keyword shows a product grid with prices, discounts, unit prices, and delivery dates.

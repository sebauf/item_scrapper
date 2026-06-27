# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

- **Scrapper** (`scrapper/`): Node.js + TypeScript, clean architecture (domain / application / infrastructure), [Crawlee](https://crawlee.dev/) with `PlaywrightCrawler`, MongoDB driver v6
- **Pipeline** (`pipeline/`): Python 3, pandas + numpy, reads `items_raw` → writes `price_history` + `deal_scores` in MongoDB
- **Airflow** (`airflow/`): orchestrates the daily scrape → refine → score pipeline via a single DAG
- **Frontend** (`frontend/`): Next.js 15, React 19, Tailwind CSS v4, MongoDB driver v6 (reads directly from DB)
- **Infrastructure** (`infra/`): MongoDB 7 in Docker with a named volume for persistence (local dev)
- **Kubernetes** (`k8s/`): Kustomize manifests deploying the full stack (frontend, Airflow, MongoDB, Postgres) in a `price-tracker` namespace

## Commands

### Infrastructure (local dev)

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

### Pipeline

```bash
cd pipeline
pip install -r requirements.txt
cp .env.example .env               # set MONGODB_URI
python -m src.pipeline             # run full pipeline (refine + score)
python -m src.refine.build_price_history   # refine only
python -m src.scoring.score                # score only
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

### Kubernetes

```bash
# copy secrets.env.example -> k8s/base/secrets.env and fill in real values
kubectl apply -k k8s/base          # deploy all resources
kubectl apply -k k8s/overlays/prod # production overlay
```

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

### Pipeline — price history + deal scoring

```
pipeline/src/
  pipeline.py               — entry point: runs refine then score
  config.py                 — MONGODB_URI + DB_NAME from .env
  refine/build_price_history.py  — aggregates items_raw → price_history
  scoring/features.py       — extracts per-product time-series rows (mean_price_30d, n_observations)
  scoring/score.py          — scores latest price vs own 30-day rolling average → deal_scores
```

Data flow: `items_raw` → `build_price_history` → `price_history` collection (one doc per URL, array of daily snapshots) → `score` → `deal_scores` collection.

Scoring logic (no trained model, no cross-product comparison):
- `score = (predictedPrice - actualPrice) / predictedPrice * 100`
- `predictedPrice` = rolling 30-day mean of that product's own past prices
- Requires `MIN_OBSERVATIONS = 5` prior observations; products with fewer are skipped
- `trendDirection` computed via linear regression on the product's own price history (`up` / `down` / `stable`)
- Stale/unreliable scores are deleted from `deal_scores` after each run

### Airflow DAG

`airflow/dags/price_pipeline_dag.py` — daily DAG (`0 6 * * *`): `scrape >> refine >> score`

Supports two execution backends via `PIPELINE_EXECUTOR` env var:
- `docker` (default, local dev): `DockerOperator`, launches sibling containers on the host's Docker socket
- `kubernetes`: `KubernetesPodOperator`, launches Pods in-cluster (used in k8s deployment)

### Key frontend files

- `src/app/page.tsx` — home: lists tracked keywords with product count + last scrape date (excludes products without a price)
- `src/app/keyword/[slug]/page.tsx` — keyword detail: product grid with price, crossed-out price, unit price, discount %, delivery date, deal score + trend
- `src/lib/mongodb.ts` — shared `MongoClient` singleton for Next.js
- `src/types/product.ts` — `Product` (with `dealScore`, `predictedPrice`, `trendDirection`) and `KeywordSummary` types

### MongoDB

- DB: `scrapper`
- `items_raw` — raw scrape output; documents have `url`, `keyword`, `shop`, `title`, `price`, `crossedOutPrice`, `unitPrice`, `images`, `deliveryDate`, `day`, `scrapedAt`
- `price_history` — one doc per URL, keyed by `_id = url`; fields: `keyword`, `shop`, `title`, `images`, `firstSeen`, `lastSeen`, `history[]`, `updatedAt`
- `deal_scores` — one doc per URL, keyed by `_id = url`; fields: `score`, `predictedPrice`, `actualPrice`, `currency`, `trendDirection`, `computedAt`
- Upsert by `(url, day)` in `items_raw` → re-runs update existing items without duplicates
- URI configured in `.env` via `MONGODB_URI`

### Kubernetes (`k8s/`)

Managed with Kustomize. Namespace: `price-tracker`.

Key resources in `k8s/base/`:
- `frontend-deployment.yaml` + `frontend-service.yaml` + `ingress.yaml` — Next.js frontend behind Traefik ingress
- `mongodb.yaml` — MongoDB StatefulSet (in-cluster), ClusterIP service + `mongodb-external` NodePort for LAN access
- `postgres.yaml` — Postgres for Airflow metadata
- `airflow-webserver.yaml` + `airflow-scheduler.yaml` — Airflow components
- `airflow-init-job.yaml` — initialises Airflow DB schema on first deploy
- `airflow-rbac.yaml` — ServiceAccount + RBAC so Airflow can launch Pods (KubernetesPodOperator)
- `airflow-ingress.yaml` — Traefik ingress for the Airflow webserver
- `configmap.env` / `secrets.env` (from `secrets.env.example`) — non-secret / secret env vars

### CI/CD (`.github/workflows/`)

Four workflows, each triggered on changes to their respective directory:
- `scrapper.yml` — builds and pushes `ghcr.io/<repo>-scrapper:<tag>`
- `pipeline.yml` — builds and pushes `ghcr.io/<repo>-pipeline:<tag>`
- `frontend.yml` — builds and pushes `ghcr.io/<repo>-frontend:<tag>`
- `airflow.yml` — builds and pushes the custom Airflow image

### Adding a crawler for a new shop

1. Create `src/domain/product/` interfaces if the data model changes
2. Create `src/infrastructure/scraping/<shop>/` — implement `IShopScraper`
3. Import and instantiate in `src/main.ts`

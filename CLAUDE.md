# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

- **Scrapper** (`scrapper/`): Node.js + TypeScript, clean architecture (domain / application / infrastructure), [Crawlee](https://crawlee.dev/) with `PlaywrightCrawler`, MongoDB driver v6
- **Pipeline** (`pipeline/`): Python 3, pandas + numpy, reads `items_raw` → writes `price_history` + `deal_scores` in MongoDB
- **Airflow** (`airflow/`): orchestrates the daily scrape → refine → score pipeline via a single DAG
- **Backend** (`backend/`): NestJS 11 on Fastify, DDD + CQRS-lite, MongoDB driver v6 — the only applicative reader of the DB
- **Frontend** (`frontend/`): Next.js 15, React 19, Tailwind CSS v4 — **no DB driver**; calls the backend API server-side (`BACKEND_URL`)
- **MCP** (`mcp/`): MCP server (`@modelcontextprotocol/sdk`, Streamable HTTP) exposing the backend API as tools for an external LLM agent — **no DB driver**, calls the backend over HTTP like the frontend
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

### Backend

```bash
cd backend
npm install
cp .env.example .env               # set MONGODB_URI
npm run start:dev                  # :3001, Swagger UI on /docs, contract on /openapi.json
npm test                           # unit tests (Jest) — domain + use cases, no DB needed
npm run build && npm run start:prod
```

See `backend/README.md` for the layering rules and the API contract.

### MCP server

```bash
cd mcp
npm install
cp .env.example .env               # MCP_AUTH_TOKEN is required (openssl rand -hex 32)
npm run start:dev                  # :3010, MCP endpoint on /mcp — needs the backend running
npm test                           # unit tests (node:test) — no backend, no DB
npm run build && npm run start:prod
npm run gen:api                    # regenerate src/backend/api-types.ts from /openapi.json
```

See `mcp/README.md` for the tool catalogue and the security model.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env               # set BACKEND_URL (defaults to http://localhost:3001)
npm run dev                        # dev server on :3000 — needs the backend running
npm run build && npm run start     # production
npm run gen:api                    # regenerate src/lib/api-types.ts from the backend's /openapi.json
```

`src/lib/api-types.ts` is generated and committed; rerun `gen:api` (with the
backend running) whenever a DTO changes, otherwise the frontend types drift
from the contract.

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

### Backend — DDD + CQRS-lite

```
src/modules/keyword/   write context: Keyword aggregate, KeywordName value object,
                       KeywordRepository port, TrackKeyword / UntrackKeyword commands
src/modules/catalog/   read-only context: ProductId / ProductQuery value objects,
                       DealPolicy, read models over items_raw / price_history / deal_scores
src/shared/            DomainError families (400/409/404), Mongo connection + required indexes
```

Dependency rule: `domain` imports nothing, `application` imports only `domain`,
`infrastructure` and `interface` may import anything. No file under `domain/`
imports `@nestjs/*` or `mongodb`.

Write side goes through the aggregate (it protects invariants). Read side goes
straight to Mongo aggregations and returns flat DTOs — `items_raw`,
`price_history` and `deal_scores` are written by the scrapper and pipeline, the
backend never mutates them, so there is no invariant to defend.

Routes are prefixed `/api/v1` except the probes (`/health/live`, `/health/ready`).
`DEAL_SCORE_THRESHOLD` lives in `catalog/domain/deal-policy.ts` — it is the single
owner of the "good deal" policy.

### Key frontend files

- `src/app/page.tsx` — dashboard: global counters + best deals per keyword
- `src/app/keywords/page.tsx` — tracked keywords, add/remove via Server Actions
- `src/app/keyword/[slug]/page.tsx` — product grid, server-side filter/sort/paginate
- `src/app/product/[id]/page.tsx` — product detail with price chart; `id` is the opaque id returned by the API
- `src/lib/api.ts` — the single data access point: typed client over the backend API
- `src/lib/api-types.ts` — **generated** from `/openapi.json`, do not edit by hand
- `src/lib/search-params.ts` — lenient parsing of the browser URL, then normalised into an API query string

The frontend owns no business rule: `isDeal` and the product `id` arrive
already computed from the backend. Scoring fields are `null` when absent (never
`undefined`), so test them with `!== null`.

### MCP server — tools over the API

```
src/config.ts     McpConfig — env vars validated at startup (same idea as backend AppConfig)
src/http.ts       HTTP facade: /mcp (Streamable HTTP, stateless), /health/live, /health/ready
src/server.ts     MCP server factory + the instructions sent to the model on initialize
src/format.ts     backend DTOs → compact text for the model (never raw JSON)
src/backend/      typed HTTP client over the API + api-types.ts (**generated**, do not edit)
src/tools/        tool definitions, split by bounded context (catalog / keywords)
```

Six tools: `get_dashboard`, `list_keywords`, `search_products`, `get_product`
(read-only), `track_keyword`, `untrack_keyword` (write, `untrack` is annotated
destructive — clients use those annotations to prompt for confirmation).

Tools return text, not JSON: the API payload is shaped for a GUI and would cost
tokens for nothing. `format.ts` always keeps the opaque product `id`, the only
key that lets the agent call `get_product` afterwards. Backend errors come back
as `isError: true` tool results, not protocol exceptions, so the agent can fix
its call.

Transport is stateless: a fresh `McpServer` + transport per request, closed with
the response. Auth is a bearer token (`MCP_AUTH_TOKEN`), compared in constant
time; the server refuses to start without it unless `MCP_ALLOW_ANONYMOUS=true`.
This is the only applicative component deliberately exposed outside the cluster.

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
- `backend-deployment.yaml` + `backend-service.yaml` — NestJS API, **ClusterIP only, no ingress**: reachable in-cluster at `http://price-tracker-backend`
- `mcp-deployment.yaml` + `mcp-service.yaml` + `mcp-ingress.yaml` — MCP server, **exposed on purpose** (the agent is off-cluster) on the `/mcp` path prefix; hostless ingress, Traefik prefers it over the frontend's `/`. Protected by `MCP_AUTH_TOKEN` from the secret, nothing else
- `frontend-deployment.yaml` + `frontend-service.yaml` + `ingress.yaml` — Next.js frontend behind Traefik ingress
- `mongodb.yaml` — MongoDB StatefulSet (in-cluster), ClusterIP service + `mongodb-external` NodePort for LAN access
- `postgres.yaml` — Postgres for Airflow metadata
- `airflow-webserver.yaml` + `airflow-scheduler.yaml` — Airflow components
- `airflow-init-job.yaml` — initialises Airflow DB schema on first deploy
- `airflow-rbac.yaml` — ServiceAccount + RBAC so Airflow can launch Pods (KubernetesPodOperator)
- `airflow-ingress.yaml` — Traefik ingress for the Airflow webserver
- `configmap.env` / `secrets.env` (from `secrets.env.example`) — non-secret / secret env vars

### CI/CD (`.github/workflows/`)

Six workflows, each triggered on changes to their respective directory:
- `backend.yml` — typechecks + tests, then builds and pushes `ghcr.io/<repo>-backend:<tag>`
- `mcp.yml` — typechecks + tests, then builds and pushes `ghcr.io/<repo>-mcp:<tag>`
- `scrapper.yml` — builds and pushes `ghcr.io/<repo>-scrapper:<tag>`
- `pipeline.yml` — builds and pushes `ghcr.io/<repo>-pipeline:<tag>`
- `frontend.yml` — builds and pushes `ghcr.io/<repo>-frontend:<tag>`
- `airflow.yml` — builds and pushes the custom Airflow image

### Adding a crawler for a new shop

1. Create `src/domain/product/` interfaces if the data model changes
2. Create `src/infrastructure/scraping/<shop>/` — implement `IShopScraper`
3. Import and instantiate in `src/main.ts`

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

- **Scrapper** (`scrapper/`): Node.js + TypeScript, clean architecture (domain / application / infrastructure), [Crawlee](https://crawlee.dev/) with `PlaywrightCrawler`, MongoDB driver v6
- **Pipeline** (`pipeline/`): Python 3, pandas + numpy, reads `items_raw` → writes `price_history` + `deal_scores` in MongoDB; also imports the official fuel-price feed into `fuel_stations`
- **Airflow** (`airflow/`): orchestrates the daily scrape → purge → refine → score pipeline, plus a separate fuel-price import DAG (every 30 min)
- **Backend** (`backend/`): NestJS 11 on Fastify, DDD + CQRS-lite, MongoDB driver v6 — the only applicative reader of the DB
- **Frontend** (`frontend/`): Next.js 15, React 19, Tailwind CSS v4, Auth.js v5 (Google login, mandatory) — **no DB driver**; calls the backend API server-side (`BACKEND_URL`), signing each call with the user's identity
- **MCP** (`mcp/`): MCP server (`@modelcontextprotocol/sdk`, Streamable HTTP) exposing the backend API as tools for an external LLM agent — **no DB driver**, calls the backend over HTTP like the frontend, on behalf of one configured account (`MCP_USER_EMAIL`)
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
npm test                           # unit tests (node:test) — pure parsers, no browser
npm run typecheck                  # tsc --noEmit
npm run spike:jsonld -- --limit=30 # mesure ce qu'Amazon expose (EAN, JSON-LD, contenance)
```

Les parseurs d'identité (`scraping/shared/`) et de prix sont des fonctions
pures : la suite tourne sans navigateur, sans réseau et sans base.

### Pipeline

```bash
cd pipeline
pip install -r requirements.txt
cp .env.example .env               # set MONGODB_URI
python -m src.pipeline             # run full pipeline (purge + refine + score)
python -m src.maintenance.purge_dead_products   # purge only (deletes data)
python -m src.refine.build_price_history        # refine only
python -m src.scoring.score                     # score only
python -m src.fuel.import_stations              # import fuel prices (calls data.economie.gouv.fr)

pip install -r requirements-dev.txt   # test deps (pytest + mongomock)
python -m pytest                      # unit tests — no MongoDB needed
```

Tests run the real aggregation pipelines against `mongomock`, so a `$group` or
`$match` written wrong fails in CI rather than in production.

### Backend

```bash
cd backend
npm install
cp .env.example .env               # set MONGODB_URI
npm run start:dev                  # :3001, Swagger UI on /docs, contract on /openapi.json
npm run token -- moi@gmail.com     # internal token for curl / Swagger « Authorize » (15 min)
npm test                           # unit tests (Jest) — domain + use cases, no DB needed
npm run build && npm run start:prod
```

See `backend/README.md` for the layering rules and the API contract.

### MCP server

```bash
cd mcp
npm install
cp .env.example .env               # MCP_AUTH_TOKEN, MCP_BACKEND_AUTH_SECRET, MCP_USER_EMAIL are required
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
cp .env.example .env               # BACKEND_URL, AUTH_SECRET, AUTH_GOOGLE_ID/SECRET, BACKEND_AUTH_SECRET
npm run dev                        # dev server on :3000 — needs the backend running
npm test                           # unit tests (Vitest + Testing Library, jsdom) — no backend, no DB
npm run typecheck                  # tsc --noEmit
npm run build && npm run start     # production
npm run gen:api                    # regenerate src/lib/api-types.ts from the backend's /openapi.json
```

`src/lib/api-types.ts` is generated and committed; rerun `gen:api` (with the
backend running) whenever a DTO changes, otherwise the frontend types drift
from the contract.

The frontend has a Dockerfile for containerised deployment.

### E2E attack tests

```bash
cd backend && npm run build; cd ../frontend && npm run build   # both builds required
cd ../e2e && npm ci && npm test    # real stack: in-memory mongod 7, backend dist, 2× next start (~1 min)
```

See `e2e/README.md`. Tests judge the **database state**, every refusal has a
positive control, and the suite was validated by mutation.

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
- `src/infrastructure/scraping/amazon/AmazonIdentityParser.ts` — caractéristiques → `{ ean, brand, mpn, asin }` (pur)
- `src/infrastructure/scraping/amazon/AmazonIdentityExtractor.ts` — sélecteurs Playwright + ordre de la cascade d'identité
- `src/infrastructure/scraping/shared/` — parseurs agnostiques de la boutique : `Gtin` (clé de contrôle GTIN), `JsonLdParser`, `QuantityParser` (contenance ramenée au litre/kilo)
- `src/scripts/spikeJsonLd.ts` — harnais de mesure de la couverture d'identité, n'écrit rien en base
- `src/infrastructure/persistence/mongodb/MongoProductRepository.ts` — upserts products by URL + day
- `src/infrastructure/persistence/mongodb/MongoKeywordRepository.ts` — CRUD for keywords
- `src/infrastructure/persistence/mongodb/MongoConnection.ts` — singleton `MongoClient`

### Pipeline — price history + deal scoring

```
pipeline/src/
  pipeline.py               — entry point: runs purge, then refine, then score
  config.py                 — MONGODB_URI + DB_NAME from .env
  maintenance/purge_dead_products.py — deletes products the scrapper can no longer read
  refine/build_price_history.py  — aggregates items_raw → price_history
  scoring/features.py       — extracts per-product time-series rows (baseline_price_30d, n_inliers, usual_low_30d / usual_high_30d, n_observations)
  scoring/score.py          — scores latest price vs own 30-day rolling average → deal_scores
```

Data flow: `items_raw` → `purge_dead_products` (deletions only) → `build_price_history` → `price_history` collection (one doc per URL, array of daily snapshots) → `score` → `deal_scores` collection.

**Purge** (`PURGE_AFTER_DAYS = 15`) is the only step that deletes data. A product
with no *usable* observation (title and price both present) for more than 15 days
is gone from `items_raw`, `price_history` and `deal_scores`. Two reasons: the
scrapper re-requests known products from `price_history` on every run
(`AmazonCrawler.buildKnownProductRequests`, oldest `lastSeen` first, capped at
`KNOWN_PRODUCTS_LIMIT_PER_KEYWORD = 150` per enabled keyword), so a dead page
costs one page of crawl budget per day for as long as it stays inside that
window; and such a product is already invisible in the UI (see the backend
freshness rule). The window is counted from the **last
scrape day**, never from `now()` — a scrapper outage must not empty the catalogue
when the pipeline next runs. URLs in `tracked_urls` or `favorites` are never
purged: they are explicit user choices, and their price history is exactly what
was asked for. It must run **before** `build_price_history`, which would
otherwise rebuild what was just deleted.

`title` et `images` sont agrégés en `$last` (le relevé du jour fait autorité :
un produit renommé doit s'afficher renommé). Les champs d'**identité** suivent
une règle différente — **dernière valeur non nulle** : un article ne change pas
de code-barres, et son absence signale une page dégradée, pas un changement
d'article. Un `$last` naïf effacerait l'EAN d'un produit sur un seul scrape
raté, avec lui sa seule clé de rapprochement inter-enseignes.

Scoring logic (no trained model, no cross-product comparison):
- `score = (predictedPrice - actualPrice) / predictedPrice * 100`
- `predictedPrice` = mean of that product's own prices over the prior 30 days, **after a Hampel filter** (`features.robust_baseline`): in log space, prices further than `HAMPEL_K = 3` robust standard deviations (MAD × 1.4826) from the median are dropped, the band never narrower than ±`MIN_BAND_PCT = 5` % (Amazon prices move in steps, the MAD is often 0). A single misread price (×10) or a past flash sale no longer drags the reference. Only the reference is filtered — never today's price (a real deal *is* an outlier), and never `price_history` (the chart shows what was actually read)
- Requires `MIN_OBSERVATIONS = 5` prior prices **kept by the filter** inside the 30-day window (`n_inliers`); products with fewer are skipped
- `trendDirection` must flag a move **the day it happens**. Two signals, in order: (1) *same-day move* — today's price outside the product's usual range (`features.usual_price_range`: the Hampel band of the prior 30 days, never narrower than ±5 %, wider for volatile products) → `down` / `up`; (2) otherwise the *trajectory* — Theil–Sen slope (median of pairwise slopes, `score.theil_sen_slope`) over the whole price history, relative to its median price, threshold ±0.5 %/day. Least squares caught same-day moves only through the last point's leverage — the same leverage that let one misread price in the history flip the trend
- Stale/unreliable scores are deleted from `deal_scores` after each run
- Products flagged `unavailable` in `price_history` (page redirected away on last visit) are skipped outright, whatever their price freshness

### Airflow DAGs

`airflow/dags/price_pipeline_dag.py` — daily DAG (`0 1 * * *`, then a random
jitter of 5 min to 3 h): `jitter >> scrape >> purge >> refine >> score`. The
`scrape` task overrides `execution_timeout` to 3 h — at 10 requests/minute a
full 1000-page crawl takes ~100 min, and a run killed half-way would hide every
product it did not reach.

A `cleanup_logs` task runs outside that chain (a failed scrape must not stop
it): it deletes Airflow's own task logs older than `AIRFLOW_LOG_RETENTION_DAYS`
(default 30). Airflow 2 never prunes them, and in k8s they live on the
fixed-size `airflow-logs` PVC mounted in the scheduler — with `LocalExecutor`
the task runs in that same Pod.

`airflow/dags/fuel_prices_dag.py` — fuel prices, `*/30 * * * *` **Europe/Paris**
(the `start_date` carries the time zone), single task
`import_fuel_stations` in the pipeline image. Independent of the scrape DAG, no
jitter (public API, no anti-bot), `max_active_runs=1` (two concurrent imports
would delete each other's stations).

Both DAGs build their container tasks through `airflow/dags/pipeline_tasks.py`
(listed in `.airflowignore`; importable because Airflow puts `dags_folder` on
`sys.path`).

Supports two execution backends via `PIPELINE_EXECUTOR` env var:
- `docker` (default, local dev): `DockerOperator`, launches sibling containers on the host's Docker socket
- `kubernetes`: `KubernetesPodOperator`, launches Pods in-cluster (used in k8s deployment)

### Backend — DDD + CQRS-lite

```
src/modules/keyword/   write context: Keyword aggregate, KeywordName value object,
                       KeywordRepository port, TrackKeyword / UntrackKeyword commands
src/modules/profile/   user profile: PhoneNumber value object (E.164), UserProfile
                       (phone + alertFuels), GET/PUT /profile — read by the restock alert
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
Every route requires an internal token except the probes (`@Public()`), see
**Authentication** below.
`DEAL_SCORE_THRESHOLD` lives in `catalog/domain/deal-policy.ts` — it is the single
owner of the "good deal" policy.

**Freshness rule** (`shared/infrastructure/mongo/last-scrape.ts`): every list and
counter only shows products refreshed by the **last scrape run** — the most recent
`items_raw.day`. A product with no row that day is one the scrapper could not read
again (dead page, redirect, block), so its last known price is a memory, not a
price. This holds only as long as every known product is actually revisited each
run, which rests on two ceilings, not one: `MAX_REQUESTS_PER_CRAWL` (1000) for
the whole crawl, and `KNOWN_PRODUCTS_LIMIT_PER_KEYWORD` (150) for the re-reads of
a single keyword. Push a keyword past 150 products, or the catalogue past the
global budget, and the filter starts hiding live products that simply weren't
revisited. The three settings travel together. Product *detail*
is deliberately exempt — favourites and tracked URLs are explicit user choices and
stay reachable by direct link.

### Authentication & per-user data

Google login is **mandatory**: nothing is reachable without a session.

```
browser ──cookie (Auth.js JWE)──▶ frontend ──Bearer HS256 60 s──▶ backend
agent ──Bearer MCP_AUTH_TOKEN──▶ MCP ──Bearer HS256 60 s (MCP_USER_EMAIL)──▶ backend
```

- **Frontend** (`src/auth.ts`, `src/middleware.ts`): Auth.js v5, Google provider,
  JWT session (no session DB — the frontend has no DB driver). The middleware
  guards every path except `/login`, `/api/auth/*`, `/api/health` and static
  files. Sign-in requires `email_verified` and, if set, membership of
  `AUTH_ALLOWED_EMAILS`; the allowlist is **re-checked on every request**
  (`authorized`), so removing an address cuts access without waiting for the
  30-day cookie. Pure rules live in `src/lib/auth-policy.ts` (incl.
  `safeCallbackPath`: only the path of `callbackUrl` is kept — no open redirect).
- **Internal token** (`backend/src/shared/infrastructure/auth/internal-token.ts`,
  copies in `frontend/src/lib/internal-token.ts` and `mcp/src/backend/internal-token.ts`):
  JWT HS256, `aud = price-tracker-backend`, 60 s, re-signed on every call.
  **One secret per issuer** (`iss` picks the key, like a `kid`, then the
  signature is checked with it): `price-tracker-frontend` signs with
  `BACKEND_AUTH_SECRET` (any user — it holds everyone's sessions);
  `price-tracker-mcp` signs with `MCP_BACKEND_AUTH_SECRET`, accepted **only for
  `MCP_USER_EMAIL`** (`onlySubject`) and required to differ from the frontend
  secret — a compromised MCP Pod cannot reach other accounts. Implemented with
  `node:crypto`; the header is compared to a fixed value (no `alg: none`, no
  algorithm confusion). Not the Google ID token: it expires after 1 h and
  Auth.js does not refresh it.
- **Server-only guard**: `frontend/src/lib/api.ts` and `lib/internal-token.ts`
  `import 'server-only'` — imported from a client component, the build fails
  (verified). Vitest aliases it to `src/testing/server-only-stub.ts`.
- **Transport**: in k8s `AUTH_URL` (public HTTPS URL) is mandatory: it makes
  Auth.js set `Secure` cookies with `__Host-` / `__Secure-` prefixes, which
  browsers never send over plain HTTP (checked by the e2e suite).
- **Quotas** (`MAX_KEYWORDS_PER_USER` = 10, `MAX_TRACKED_URLS_PER_USER` = 100,
  0 = unlimited; domain classes `KeywordQuota` / `TrackedUrlQuota`): the crawl
  budget is shared (~155 requests per keyword at worst, 1 per tracked URL, on
  `MAX_REQUESTS_PER_CRAWL` = 1000), so one account must not be able to starve
  the others. Counts the user's subscriptions; favourites count as tracked
  URLs. Refusal = 409 `KEYWORD_QUOTA_EXCEEDED` / `PRODUCT_URL_QUOTA_EXCEEDED`,
  checked after « already tracked »; `addFavoriteAction` **returns** the
  message (Next hides thrown action errors in prod) and the star displays it.
  Count-then-write is not atomic: concurrent adds can exceed by one.
- **Backend**: `AuthGuard` (global, set in `configureApp`, so API tests go
  through it) → `request.user`; controllers read it with `@CurrentUser()` and
  pass a `UserId` explicitly to commands/queries (no request-scoped providers).
- **User id = verified Google email, lower-cased** (`shared/domain/user-id.ts`),
  not Google's `sub`: allowlist, legacy owner and MCP account are configured
  by email, and docs stay readable. Trade-off: a reassigned Workspace address
  would inherit the previous owner's data.

What is personal vs shared:

| Data | Model | Shared part |
|---|---|---|
| keywords | `keywords.subscribers[]` (emails) | the term and its scrape — two users on « lessive » trigger one search |
| tracked URLs | `tracked_urls.subscribers[]` | the URL and its price history |
| favourites | `favorites { userId, url, addedAt }` | — |
| favourite stations | `favorite_stations { userId, stationId, addedAt }` | — (each user's restock alert watches their own) |
| profile | `user_profiles { _id: userId, phone, alertFuels }` | — |
| catalogue, scores, fuel prices | — | entirely shared; product grids are not filtered per user |

`enabled` on `keywords` / `tracked_urls` is **derived** from `subscribers`
(true while at least one remains), written in the same `updateOne` with an
aggregation-pipeline update (`shared/infrastructure/mongo/subscriptions.ts`) —
atomic per document, and the scrapper keeps reading `enabled: true` unchanged.
Untracking only removes the caller; the last one out stops the scrape. The
dashboard counts only the user's perimeter (their keywords + tracked URLs).

**Legacy data** (created before accounts: no `subscribers` / no `userId`) is
attached at backend start-up to `AUTH_LEGACY_OWNER_EMAIL`
(`shared/infrastructure/mongo/legacy-ownership.ts`, idempotent: only ownerless
docs). Unset → a warning lists the orphans, which nobody sees (orphan keywords
with `enabled: true` are still scraped). The scrapper's default-keyword seed on
an empty collection produces such orphans; they are attached on the next
backend start.

### Fuel prices — official open data, not scraping

Source: « Prix des carburants en France — Flux instantané v2 » on
data.economie.gouv.fr (Licence Ouverte; stations selling > 500 m³/year must
declare every price change and shortage). Read through the Opendatasoft
`exports/json` endpoint (whole dataset in one call; `records` caps at 10 000),
with `timezone=UTC`.

- `pipeline/src/fuel/import_stations.py` — one `fuel_stations` doc per station,
  **replaced** on each import; stations absent from the feed are deleted, but only
  after a guard: an import yielding fewer than half the known stations raises
  `TruncatedFeedError` and touches nothing. API coordinates are degrees × 100 000.
  A fuel is *sold* if it has a price or a temporary shortage (`rupture_type =
  definitive` drops it), *available* if priced with no shortage.
- `pipeline/src/fuel/brands.py` — **brand (enseigne)**, absent from the official
  feed, comes from OpenStreetMap: OSM stations carry the official id in
  `ref:FR:prix-carburants`, so the match is by **exact id**, never by distance.
  Source: the OSM export CSV (bz2) on data.gouv.fr, fetched on each import
  (~95 % of stations matched). `BRAND_ALIASES` folds OSM spellings into one label
  (`Total Access` → `TotalEnergies`, `Super U` → `Système U`, `E. Leclerc` →
  `E.Leclerc`…); unknown values are kept as-is. `operator` is ignored on purpose
  (it is the operating company, not the brand). If the export is unreachable or
  truncated, the import keeps the brands already stored — prices still update.
  OSM data is **ODbL**: attribution is required wherever brands are shown (the
  map's attribution line covers it).
- `pipeline/src/fuel/restock_alerts.py` — **restock alert, per user**, opt-in
  (off unless `FUEL_RESTOCK_WEBHOOK_URL` is set; `FUEL_RESTOCK_WEBHOOK_SECRET`
  is mandatory with it — unsigned, the route would text any number). A user is
  watched only if they have **all three**: a phone (`user_profiles.phone`,
  E.164), at least one fuel (`user_profiles.alertFuels`) and at least one
  **favourite station** (`favorite_stations` with `userId`, starred on the fuel
  map). Same rule as the backend's `UserProfile.missingForFuelAlerts`, shown on
  the profile page; a legacy favourite without `userId` alerts nobody. The
  former global zone (`FUEL_WATCH_LAT/LNG/RADIUS_KM`, `FUEL_WATCH_FUELS`) is
  gone. The import keeps no history, and a station closing its shortages
  without re-declaring a price drops out of `fuel_stations` for a while — so
  the alert keeps its own **last known state** per (user × favourite station ×
  watched fuel) in `fuel_watch_state`, after each import: per user, because
  sends are per user and one can fail while another succeeds. A **restock** =
  a fuel now `available: true` whose last known state is `available: false`,
  however many imports in between. Absent station / absent fuel never changes
  the state; a first sighting (new favourite, fuel just ticked, phone just set)
  is recorded without alerting; states no longer watched are deleted
  (including old `<stationId>:<fuel>` docs). Restocks trigger **one webhook
  per recipient** per import to `FUEL_RESTOCK_WEBHOOK_URL` (a Hermes agent
  route), signed with Hermes' Generic V2 scheme (`X-Webhook-Signature-V2` =
  HMAC-SHA256 of `<timestamp>.<body>`), `X-Request-ID` derived from the import
  and a hash of the user. The payload carries the recipient in **`to`**
  (E.164) and a ready-to-send French `summary` — never the user's email — so
  the route runs `deliver_only` with `prompt: "{summary}"` and
  `deliver_extra: { chat_id: "{to}" }` (`deliver: sms`, `whatsapp`, `signal`…).
  New stations and fuels not sold before are not restocks. A failed send is
  logged (phone masked), never fails the import, and leaves **that user's**
  state at « shortage », so their alert is retried on the next import (every
  30 min). In k8s these vars live in `secrets.env` (task Pods only read the
  Secret); in Docker, `pipeline_tasks.py` relays them from the Airflow env.
- `backend/src/modules/fuel/` — reads `fuel_stations`, `GET /api/v1/fuel-stations`
  (`lat`, `lng` required; `radiusKm` ≤ 30, `fuel`, `sort=distance|price`, price
  sort requires `fuel`; `brand` = exact unified label, filtered inside `$geoNear`
  so the 200 cap applies after it). The response carries `brands[]` — brands in
  the radius with their station count, fuel filter applied but **not** the brand
  filter (otherwise the selector would only offer the chosen brand). `$geoNear` on the `location_2dsphere` index (created by
  the backend's `ensureIndexes`), capped at 200 stations (`truncated` flag).
  Each station carries `isFavorite` (for the requesting user). Also owns
  **favourite stations** (`favorite_stations`, per user, the only fuel
  collection the backend writes):
  `GET /api/v1/fuel-stations/favorites`, `PUT` / `DELETE
  /api/v1/fuel-stations/favorites/:id` (idempotent, 204; `PUT` → 404 if the
  station is not in the feed, 400 if the id is not digits).
- **Freshness** (`fuel/domain/freshness-policy.ts`, `STALE_AFTER_HOURS = 72`) is
  judged on the station's own declaration date (`updatedAt`), never on our import
  date — and stale prices are **flagged, not hidden** (an old price may simply be
  unchanged). Opposite of the Amazon freshness rule on purpose.
- `frontend/src/app/fuel/page.tsx` — Leaflet map (`react-leaflet`, OpenStreetMap
  tiles, client-only via `next/dynamic`) + list. Searches go through the URL
  (the backend is unreachable from the browser). Browser geolocation requires
  HTTPS; « Rechercher ici » (pan the map) works without it. Brand selector
  defaults to **TotalEnergies** (`DEFAULT_BRAND` in `lib/fuel.ts`); `brand=all`
  in the URL shows every brand, as `fuel=all` does for fuels. Each listed station
  has a star (`FavoriteStationButton`, optimistic, rolled back on failure) that
  adds it to the user's favourite stations, the ones their restock alert watches.
  Each station also links to **Google Maps** (`googleMapsUrl` in `lib/fuel.ts`,
  Maps URLs API, no key) — in the list (a sibling of the select button, like the
  star) and in the map popup next to the OSM itinerary. The link is a text search
  « brand, address, postcode city » so Google resolves the station's place card
  (better navigation); coordinates only when the feed has no address.

### Key frontend files

- `src/auth.ts` — Auth.js config (Google, JWT session, allowlist); `src/middleware.ts` — session required everywhere but `/login`, `/api/auth`, `/api/health`
- `src/app/login/page.tsx` — sign-in page (also handles a session whose address left the allowlist, without redirect loop); `src/components/UserMenu.tsx` — name + sign-out
- `src/app/api/health/route.ts` — k8s probe, outside the auth middleware
- `src/app/page.tsx` — dashboard: counters + best deals per keyword, on the user's perimeter
- `src/app/keywords/page.tsx` — tracked keywords, add/remove via Server Actions
- `src/app/keyword/[slug]/page.tsx` — product grid, server-side filter/sort/paginate
- `src/app/product/[id]/page.tsx` — product detail with price chart; `id` is the opaque id returned by the API
- `src/app/profile/page.tsx` + `src/components/ProfileForm.tsx` — phone number + watched fuels for the restock alert, and its status (`fuelAlerts.missing` from the backend); reached from the avatar in `UserMenu`
- `src/app/fuel/page.tsx` + `src/components/FuelExplorer.tsx` / `FuelMap.tsx` — fuel-price map; `src/lib/fuel.ts` holds its URL parsing and display rules
- `src/lib/api.ts` — the single data access point: typed client over the backend API; adds `Authorization` (internal token for the session's email) to every call, redirects to `/login` without session
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
Towards the backend, it acts for **one** account (`MCP_USER_EMAIL`), signing
the internal token with its own `MCP_BACKEND_AUTH_SECRET`, which the backend
accepts for that account only: the tools read and modify that account's
keywords, favourites and tracked URLs, and nothing else.

### MongoDB

- DB: `scrapper`
- `items_raw` — raw scrape output; documents have `url`, `keyword`, `shop`, `title`, `price`, `crossedOutPrice`, `unitPrice`, `images`, `deliveryDate`, `day`, `scrapedAt`, plus l'identité de l'article : `ean` (GTIN-13 vérifié), `brand`, `mpn`, `quantity` (`{ amount, unit }` en L ou kg), `packSize`, `doses` — tous nullables, une fiche ne publiant pas toujours son code-barres
- `price_history` — one doc per URL, keyed by `_id = url`; fields: `keyword`, `shop`, `title`, `images`, `firstSeen`, `lastSeen`, `history[]`, `updatedAt`, les champs d'identité remontés d'`items_raw` (`ean`, `brand`, `mpn`, `quantity`, `packSize`, `doses`), plus `unavailable` / `unavailableSince` set by the scrapper when a product page redirects away (never deletes the doc or its history — the product may come back into stock; the flag is cleared on the next successful scrape)
- `deal_scores` — one doc per URL, keyed by `_id = url`; fields: `score`, `predictedPrice`, `actualPrice`, `currency`, `trendDirection`, `computedAt`
- `fuel_stations` — one doc per fuel station, keyed by `_id` = official station id; fields: `location` (GeoJSON Point, **[lng, lat]**), `brand` (unified OSM brand or null), `name` (OSM station name or null), `address`, `city`, `postcode`, `roadType` (`R` road / `A` motorway / null), `fuels[]` (`code` ∈ gazole/e10/sp98/sp95/e85/gplc, `price`, `updatedAt` = station's declaration, `available`, `shortageSince`), `importedAt`. Written only by the fuel import
- `keywords` — one doc per scraped term; `keyword` (unique), `enabled` (read by the scrapper, derived from `subscribers`), `subscribers[]` (emails of the users tracking it). Written by the backend (and seeded by the scrapper on an empty collection)
- `tracked_urls` — one doc per individually tracked product URL; `url` (unique), `enabled`, `subscribers[]` — same model as `keywords`. Never deleted, so the purge keeps sparing it
- `favorites` — one doc per (user, product); `userId`, `url`, `addedAt`; unique index `userId_url` (partial on `userId` existing). Written by the backend; `url` read by the purge
- `favorite_stations` — one doc per (user, station); `userId`, `stationId` (official id), `addedAt`; unique index `userId_stationId`. Legacy docs keep `_id` = station id. Written only by the backend (star on the fuel map), read by the pipeline's restock alert (each user's own stations). Not purged when a station leaves the feed (it becomes useful again if the station comes back)
- `user_profiles` — one doc per user, `_id` = user id (email); `phone` (E.164 or null), `alertFuels[]` (fuel codes), `updatedAt`. Written only by the backend (profile page, `PUT /api/v1/profile`), read by the restock alert (recipient + fuels)
- `fuel_watch_state` — last known state of each (user × favourite station × watched fuel), keyed by `_id = "<userId>:<stationId>:<fuel>"`; fields: `userId`, `stationId`, `fuel`, `available`, `shortageSince`, `seenAt`. Written only by the restock alert (`restock_alerts.py`), after each import
- Upsert by `(url, day)` in `items_raw` → re-runs update existing items without duplicates
- URI configured in `.env` via `MONGODB_URI`

### Kubernetes (`k8s/`)

Managed with Kustomize. Namespace: `price-tracker`.

Key resources in `k8s/base/`:
- `backend-deployment.yaml` + `backend-service.yaml` — NestJS API, **ClusterIP only, no ingress**: reachable in-cluster at `http://price-tracker-backend`; still requires a signed internal token on every route but the probes
- `mcp-deployment.yaml` + `mcp-service.yaml` + `mcp-ingress.yaml` — MCP server, **exposed on purpose** (the agent is off-cluster) on the `/mcp` path prefix; hostless ingress, Traefik prefers it over the frontend's `/`. Protected by `MCP_AUTH_TOKEN` from the secret, nothing else
- `frontend-deployment.yaml` + `frontend-service.yaml` + `ingress.yaml` — Next.js frontend behind Traefik ingress; probes on `/api/health`. Google only accepts **HTTPS on a public domain** (or localhost) as OAuth redirect URI (`<domain>/api/auth/callback/google`): login works only through that domain
- `mongodb.yaml` — MongoDB StatefulSet (in-cluster), ClusterIP service + `mongodb-external` NodePort for LAN access
- `postgres.yaml` — Postgres for Airflow metadata
- `airflow-webserver.yaml` + `airflow-scheduler.yaml` — Airflow components
- `airflow-init-job.yaml` — initialises Airflow DB schema on first deploy
- `airflow-rbac.yaml` — ServiceAccount + RBAC so Airflow can launch Pods (KubernetesPodOperator)
- `airflow-ingress.yaml` — Traefik ingress for the Airflow webserver
- `configmap.env` / `secrets.env` (from `secrets.env.example`) — non-secret / secret env vars; auth keys: `BACKEND_AUTH_SECRET`, `MCP_BACKEND_AUTH_SECRET`, `AUTH_SECRET`, `AUTH_URL` (HTTPS, required), `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_ALLOWED_EMAILS`, `AUTH_LEGACY_OWNER_EMAIL`, `MCP_USER_EMAIL`; quotas are plain env values in `backend-deployment.yaml` (`install.sh` asks for / generates them, including on an existing `secrets.env`)

### CI/CD (`.github/workflows/`)

Seven workflows, each triggered on changes to their respective directory:
- `backend.yml` — typechecks + tests, then builds and pushes `ghcr.io/<repo>-backend:<tag>`
- `mcp.yml` — typechecks + tests, then builds and pushes `ghcr.io/<repo>-mcp:<tag>`
- `frontend.yml` — typechecks + tests, then builds and pushes `ghcr.io/<repo>-frontend:<tag>`
- `pipeline.yml` — tests, then builds and pushes `ghcr.io/<repo>-pipeline:<tag>`
- `scrapper.yml` — typechecks + tests, then builds and pushes `ghcr.io/<repo>-scrapper:<tag>`
- `airflow.yml` — builds and pushes the custom Airflow image
- `e2e.yml` — builds backend + frontend, then runs the attack suite (`e2e/`) on backend/frontend/e2e changes; independent of the image workflows, make it a required check to block merges

Every workflow that has tests runs them in a `test` job that the
`build-and-push` job declares as `needs:` — a red suite stops the publication.
Those workflows also run on pull requests (tests only, no image pushed).

### Adding a crawler for a new shop

1. Create `src/domain/product/` interfaces if the data model changes
2. Create `src/infrastructure/scraping/<shop>/` — implement `IShopScraper`
3. Import and instantiate in `src/main.ts`

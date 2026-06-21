# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

- **Scrapper** (`scrapper/`): Node.js + TypeScript, [Crawlee](https://crawlee.dev/) with `PlaywrightCrawler`, MongoDB driver v6
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
npm run start                      # run the scraper
npm run build                      # compile to dist/
npm run start:prod                 # run compiled output
```

## Architecture

### Data flow

`main.ts` → initialise MongoDB → instancie un crawler par boutique → `crawler.run(urls)` → chaque page est traitée par un handler dans `routes/` → les données sont upsertées dans MongoDB via `storage/mongodb.ts`

### Key files

- `src/main.ts` — point d'entrée : connexion MongoDB, instanciation et lancement des crawlers
- `src/crawlers/amazon.ts` — configure `PlaywrightCrawler` (headless, maxRequests, user-agent rotatif via Crawlee)
- `src/routes/amazon.ts` — extrait titre, prix, images depuis une page produit Amazon
- `src/storage/mongodb.ts` — singleton `MongoClient`, type `ScrapedItem`, fonction `upsertItem()` (upsert par `url`)

### MongoDB

- DB : `scrapper`, collection : `items`
- Upsert par `url` → un re-run met à jour les items existants sans créer de doublons
- URI configurée dans `.env` via `MONGODB_URI`

### Ajouter un crawler pour une nouvelle boutique

1. Créer `src/routes/<shop>.ts` — implémenter l'extraction en suivant le pattern `amazon.ts`
2. Créer `src/crawlers/<shop>.ts` — instancier `PlaywrightCrawler` avec le bon handler
3. Importer et lancer le crawler dans `src/main.ts`

# Item Scrapper

Scraper de produits Amazon basé sur des mots-clés. Extrait titre, prix, prix barré, prix au litre, date de livraison et images, puis sauvegarde les résultats dans MongoDB.

## Stack

- **Node.js + TypeScript**
- **[Crawlee](https://crawlee.dev/)** avec `PlaywrightCrawler` (Chromium headless)
- **MongoDB** via le driver officiel v6

## Prérequis

- Node.js ≥ 18
- MongoDB en cours d'exécution (voir `../infra/`)

## Installation

```bash
npm install
npx playwright install chromium   # première fois uniquement
cp .env.example .env
```

## Configuration

| Variable | Description | Défaut |
|----------|-------------|--------|
| `MONGODB_URI` | URI de connexion MongoDB | `mongodb://admin:password@localhost:27017/scrapper?authSource=admin` |
| `MAX_REQUESTS_PER_CRAWL` | Nombre max de requêtes par run | `200` |

## Lancement

```bash
npm run start        # run direct avec tsx
npm run build        # compile vers dist/
npm run start:prod   # run depuis dist/
```

## Mots-clés à scraper

Les recherches sont configurées dans `src/main.ts` :

```ts
const AMAZON_KEYWORDS: string[] = [
  'lessive liquide',
];
```

Ajouter un mot-clé = ajouter une entrée dans ce tableau.

## Architecture

```
src/
├── main.ts              # Point d'entrée : connexion MongoDB + lancement crawler
├── crawlers/
│   └── amazon.ts        # Configuration PlaywrightCrawler (anti-détection, sessions)
├── routes/
│   └── amazon.ts        # Router : handler SEARCH (pages résultats) + handler PRODUCT (fiches)
└── storage/
    └── mongodb.ts       # Connexion MongoDB, type ScrapedItem, upsertItem()
```

### Flux de données

1. `main.ts` construit les URLs de recherche Amazon (`/s?k=<mot-clé>`)
2. Le handler `SEARCH` extrait les liens produits et gère la pagination (jusqu'à 5 pages)
3. Les URLs produits sont normalisées en `amazon.fr/dp/<ASIN>/` pour éviter les doublons
4. Le handler `PRODUCT` scrape chaque fiche et upserte en MongoDB

## Données collectées

Chaque document dans la collection `items_raw` contient :

| Champ | Type | Description |
|-------|------|-------------|
| `url` | string | URL canonique (`/dp/ASIN/`) |
| `title` | string | Titre du produit |
| `price` | number | Prix actuel |
| `currency` | string | Devise (`€`) |
| `crossedOutPrice` | number | Prix barré (prix conseillé avant réduction) |
| `unitPrice` | number | Prix unitaire (ex: `3.18`) |
| `unitPriceUnit` | string | Unité du prix unitaire (ex: `l`, `100 ml`, `kg`) |
| `deliveryDate` | string | Date de livraison estimée |
| `images` | string[] | URLs des images miniatures |
| `shop` | string | Boutique (`amazon`) |
| `keyword` | string | Mot-clé de recherche ayant produit ce résultat |
| `scrapedAt` | Date | Horodatage du scrape |
| `day` | Date | Début du jour UTC (clé d'unicité avec `url`) |

**Index unique :** `{ url, day }` — un re-run le même jour met à jour le document existant, le lendemain crée un nouveau document (historique des prix).

## Anti-détection

- `navigator.webdriver` masqué via `preNavigationHooks`
- `--disable-blink-features=AutomationControlled`
- Fingerprinting réaliste (Chrome ≥ 115, Windows desktop) via Crawlee
- Concurrence limitée : `maxConcurrency: 2`, `maxRequestsPerMinute: 10`
- Session pool avec cookies persistants (10 sessions, retraite après 50 usages)
- Scroll aléatoire + délai humain sur chaque page produit

## Ajouter un crawler pour une nouvelle boutique

1. Créer `src/routes/<boutique>.ts` — implémenter les handlers en suivant le pattern `amazon.ts`
2. Créer `src/crawlers/<boutique>.ts` — instancier `PlaywrightCrawler` avec le router
3. Importer et lancer le crawler dans `src/main.ts`

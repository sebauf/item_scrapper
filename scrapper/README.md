# Scrapper

Collecte quotidienne des fiches produit. Relève prix, prix barré, prix
unitaire, date de livraison, images et **identité de l'article** (code-barres,
marque, contenance), puis écrit le tout dans MongoDB.

C'est le seul composant qui sort sur le web. Il n'expose aucune API : il est
lancé en batch (par Airflow en production, à la main en développement), écrit
dans `items_raw`, et s'arrête.

## Stack

- **Node.js 22 + TypeScript** (ESM, imports en `.js`) — version de l'image Docker et de la CI
- **[Crawlee](https://crawlee.dev/)** avec `PlaywrightCrawler` (Chromium headless)
- **MongoDB** via le driver officiel v6

## Installation

```bash
npm install
npx playwright install chromium   # première fois uniquement
cp .env.example .env
```

## Configuration

| Variable | Rôle | Défaut |
|---|---|---|
| `MONGODB_URI` | URI de connexion MongoDB | `mongodb://admin:password@localhost:27017/scrapper?authSource=admin` |
| `MAX_REQUESTS_PER_CRAWL` | Budget de pages par exécution | `200` |

## Commandes

```bash
npm run start        # exécution directe (tsx)
npm run build        # compile vers dist/
npm run start:prod   # exécute dist/main.js
npm test             # tests unitaires (node:test) — ni navigateur, ni réseau, ni base
npm run typecheck    # tsc --noEmit
```

Les parseurs (prix, contenance, identité, JSON-LD) sont des fonctions pures :
la suite tourne en CI sans installer Chromium.

## Architecture

Architecture propre, trois couches, la dépendance ne va que vers l'intérieur :

```
src/
├── domain/                  entités + interfaces de dépôt ; n'importe rien
│   ├── product/             Product, Price, UnitPrice, Quantity, IProductRepository
│   ├── keyword/             Keyword (type marqué) + IKeywordRepository
│   └── trackedUrl/          TrackedUrl (type marqué) + ITrackedUrlRepository
├── application/             cas d'usage ; n'importe que le domaine
│   ├── ScrapeProductsUseCase.ts
│   ├── SeedKeywordsUseCase.ts
│   └── ports/IShopScraper.ts
├── infrastructure/          implémentations ; peut tout importer
│   ├── persistence/mongodb/ dépôts Mongo + connexion
│   └── scraping/
│       ├── shared/          parseurs agnostiques de la boutique
│       └── amazon/          crawler + handlers Amazon
├── scripts/                 outils ponctuels, hors du flux nominal
└── main.ts                  point d'entrée : câblage des dépendances
```

`IShopScraper` est le point d'extension : il ne mentionne ni Amazon ni URL, une
seconde enseigne s'y branche sans toucher au domaine ni aux cas d'usage.

### Flux d'une exécution

1. `main.ts` ouvre la connexion Mongo et câble les dépôts avec `AmazonCrawler`.
2. `SeedKeywordsUseCase` amorce les mots-clés par défaut **si la collection
   `keywords` est vide** — c'est un amorçage de premier démarrage, pas une
   configuration (voir ci-dessous).
3. `ScrapeProductsUseCase` lit les mots-clés et les URLs suivies *activés*, et
   délègue au scraper. Sans rien d'activé, il journalise et sort.
4. `AmazonCrawler` construit la file de requêtes, puis Crawlee la déroule.

## Ce qui est visité, et dans quel ordre

La file de départ mélange trois origines :

| Origine | Construction | Volume |
|---|---|---|
| **Pages de recherche** | `amazon.fr/s?k=<mot-clé>` pour chaque mot-clé activé | jusqu'à 5 pages de résultats par mot-clé |
| **Produits déjà connus** | URLs relues depuis `price_history`, pour continuer leur historique de prix | 150 par mot-clé |
| **URLs suivies** | `tracked_urls` — fiches suivies à l'unité, hors recherche | toutes celles activées |

S'y ajoutent, découvertes en cours de route, les **variantes** d'un produit
(bloc `#twister` : contenances et parfums d'une même fiche), enfilées vers leur
propre page `/dp/ASIN/`.

Deux conséquences pratiques :

- **Le budget est la vraie contrainte.** `MAX_REQUESTS_PER_CRAWL` (200 par
  défaut) est saturé bien avant d'avoir tout visité — 3 mots-clés suffisent à
  produire ~450 relectures de produits connus. Ce n'est pas un défaut : les
  produits connus sont triés par `lastSeen` croissant, donc **les moins
  récemment vus passent en premier**. D'un jour sur l'autre, le catalogue
  tourne au lieu de rescanner toujours les mêmes fiches.
- **Les URLs sont canonicalisées en `amazon.fr/dp/<ASIN>/`** dès la page de
  recherche. Sans cela, la même fiche atteinte par deux chemins (paramètres de
  suivi, `/gp/product/`) ouvrirait deux historiques de prix distincts.

### Mots-clés et URLs suivies

Ils vivent en base, pas dans le code :

| Collection | Forme | Qui écrit |
|---|---|---|
| `keywords` | `{ keyword, enabled }`, index unique sur `keyword` | l'API backend (écran « Mots-clés ») |
| `tracked_urls` | `{ url, enabled }`, index unique sur `url` | l'API backend (écran « Suivi ») |

Le scrapper ne fait que **lire** les entrées activées. `DEFAULT_KEYWORDS` dans
`src/main.ts` ne sert qu'à peupler une base neuve ; y ajouter une ligne n'a
aucun effet sur une base déjà amorcée. Pour suivre un nouveau mot-clé, passer
par le frontend ou l'API.

## Données collectées

Un document par `(url, jour)` dans `items_raw`, **index unique `{ url, day }`** :
relancer le scrapper le même jour met à jour le document existant, le
lendemain en crée un nouveau. C'est ce qui constitue l'historique de prix.

### Offre — ce que la boutique vend aujourd'hui

| Champ | Type | Note |
|---|---|---|
| `url` | `string` | URL canonique `/dp/ASIN/` |
| `title` | `string` | |
| `price` | `{ amount, currency } \| null` | devise en ISO (`EUR`), pas en symbole |
| `crossedOutPrice` | `{ amount, currency } \| null` | prix barré avant réduction |
| `unitPrice` | `{ amount, unit } \| null` | prix rapporté à une unité, ex. `{ 3.18, "l" }` |
| `deliveryDate` | `string \| null` | texte brut de la fiche |
| `images` | `string[]` | miniatures ramenées à leur version haute résolution |
| `shop` | `string` | `amazon` |
| `keyword` | `string \| null` | mot-clé ayant produit ce résultat ; `null` pour une URL suivie à l'unité |
| `scrapedAt` | `Date` | horodatage du relevé |
| `day` | `Date` | début du jour UTC — clé d'unicité avec `url` |

### Identité — ce qu'est l'article, quelle que soit la boutique

Ces champs servent à rapprocher un article entre enseignes. Ils sont **tous
facultatifs** : une fiche ne publie pas toujours son code-barres.

| Champ | Type | Note |
|---|---|---|
| `ean` | `string \| null` | GTIN-13, vérifié par sa clé de contrôle ; `null` si absent, invalide **ou ambigu** |
| `brand` | `string \| null` | |
| `mpn` | `string \| null` | référence fabricant — second identifiant quand l'EAN manque |
| `quantity` | `{ amount, unit } \| null` | contenance totale ramenée au litre ou au kilo, multiplicateur de lot appliqué |
| `packSize` | `number \| null` | « lot de 3 », « 3 × 1 L » ; `null` si vendu à l'unité |
| `doses` | `number \| null` | nombre de lavages / doses / capsules |

Le parti pris est de **refuser plutôt que de deviner**, champ par champ : une
fiche portant plusieurs EAN (cas des lots) ressort sans code-barres, un titre
portant deux contenances (« Lessive 1 L + Adoucissant 750 ml ») ressort sans
contenance. Les autres champs sont conservés, et chaque refus est journalisé en
avertissement — ce sont ces lignes qu'il faudra surveiller si Amazon refond ses
fiches.

La raison de cette sévérité tient en une asymétrie : un rapprochement manqué ne
coûte qu'une comparaison absente, un rapprochement faux coûte la confiance dans
l'outil.

Détail et mesure de couverture : `../docs/spike-jsonld-amazon.md`.

## Produits disparus

Quand une page `/dp/ASIN/` redirige ailleurs, le produit n'est plus en vente.
Le scrapper ne supprime alors **ni le document ni son historique** — une rupture
de stock n'est pas une disparition, et le produit peut revenir :

- `price_history` reçoit `unavailable: true` et `unavailableSince` ;
- le document correspondant de `deal_scores` est supprimé, pour qu'un produit
  indisponible sorte immédiatement du tableau de bord ;
- au premier relevé réussi suivant, le drapeau est levé.

Une page sans titre exploitable (blocage probable) est en revanche simplement
ignorée : rien n'est écrit, rien n'est marqué.

## Anti-détection

- `navigator.webdriver` masqué via un `preNavigationHook`
- `--disable-blink-features=AutomationControlled`
- empreinte de navigateur générée par le `browserPool` de Crawlee
- allure volontairement basse : `maxConcurrency: 2`, `maxRequestsPerMinute: 10`
- pool de sessions à cookies persistants (10 sessions, retirées après 50 usages
  ou 3 erreurs)
- défilement et temporisation aléatoires sur chaque fiche

## Scripts ponctuels

Hors du flux nominal, à lancer à la main :

```bash
npm run migrate:legacy-data          # devises symboliques → ISO, images en haute résolution
npm run spike:jsonld -- --limit=30   # mesure ce qu'Amazon expose : JSON-LD, EAN, contenance
```

`spike:jsonld` ne modifie aucune collection : il lit `price_history` pour tirer
un échantillon, visite les fiches et écrit un relevé JSON local.

`src/scripts/verifyVariants.ts` (`npx tsx src/scripts/verifyVariants.ts`) rejoue
le handler produit sur une seule fiche, dont l'URL est codée en dur en tête du
fichier — utile pour mettre au point un sélecteur sans lancer un crawl complet.

## Ajouter une boutique

1. Écrire les parseurs propres à l'enseigne dans
   `src/infrastructure/scraping/<boutique>/`, en réutilisant
   `scraping/shared/` (`Gtin`, `JsonLdParser`, `QuantityParser`) — ces trois-là
   sont agnostiques de la boutique et couverts par des tests.
2. Implémenter `IShopScraper` dans un `<Boutique>Crawler`.
3. L'instancier dans `src/main.ts`.

⚠️ Avant d'y aller, lire `../docs/etude-magasin-concurrent.md` §2.5 : trois points
du code supposent aujourd'hui une boutique unique, dont
`findKnownUrlsByKeyword`, qui ne filtre pas sur `shop` et servirait des URLs
d'une enseigne au crawler d'une autre — en silence.

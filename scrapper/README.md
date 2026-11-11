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
| `MAX_REQUESTS_PER_CRAWL` | Budget de pages par exécution | `1000` |

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

- **Le budget doit couvrir tout le catalogue.** `MAX_REQUESTS_PER_CRAWL` (1000
  par défaut) est dimensionné pour relire **chaque** fiche connue à chaque
  exécution : 3 mots-clés produisent déjà ~450 relectures, auxquelles
  s'ajoutent les pages de recherche et les variantes. C'est une contrainte de
  correction, pas de confort : le backend masque les produits que le dernier
  passage n'a pas rafraîchis (`backend/src/shared/infrastructure/mongo/last-scrape.ts`),
  donc un budget saturé ferait disparaître des fiches bien vivantes. Les
  produits connus restent triés par `lastSeen` croissant : si le budget vient
  malgré tout à manquer, ce sont les moins récemment vus qui passent en
  premier. À 10 requêtes/minute, 1000 pages ≈ 100 min, sous
  l'`execution_timeout` de 3 h de la tâche Airflow.
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
| `packSize` | `number \| null` | nombre d'unités vendues ensemble ; `1` = vendu à l'unité **déclaré par la fiche** ; `null` = non établi |
| `quantity` | `{ amount, unit } \| null` | contenance **totale** de l'offre, ramenée au litre ou au kilo |
| `unitQuantity` | `{ amount, unit } \| null` | contenance d'**une** unité du lot |
| `doses` | `number \| null` | nombre **total** de doses ou de pièces (lavages, capsules, brossettes, filtres…) |
| `unitDoses` | `number \| null` | doses ou pièces d'**une** unité |
| `identityDiagnostics` | objet \| `null` | traces de l'extraction — `items_raw` seulement, voir ci-dessous |

**Pourquoi le lot compte autant que l'EAN.** Un EAN désigne l'unité que
fabrique la marque — la bouteille. Un lot constitué par le vendeur (« lot de
2 » Amazon, Marketplace) reprend en général l'EAN de cette bouteille : deux
offres de même EAN ne sont identiques que si elles ont **le même `packSize`**.
D'où la séparation des grandeurs par unité (l'article) et totales (l'offre).

Le nombre d'unités croise deux sources (`shared/PackReconciler.ts`) : le titre
(« lot de 3 », « 3 x 1 L », « 3 x 40 tablettes », « 1,36L (x6) ») et la
caractéristique « Nombre d'articles ». « Nombre d'unités » est ignoré : Amazon
y publie souvent une contenance. Un titre muet ne suffit pas à écrire `1` ; un
désaccord entre les deux sources annule le lot et les totaux mais garde les
grandeurs unitaires, vraies dans les deux lectures ; un lot déclaré que le
titre tait laisse la contenance inconnue (une ou trois bouteilles ?).

Les **pièces** se comptent comme les doses : un blister Oral-B de 8 brossettes
est *une* unité (un EAN) de 8 pièces. Vocabulaire reconnu : lavages, doses,
capsules, tablettes, pastilles, sachets, lingettes, brossettes, têtes, filtres,
cartouches, recharges. « Pack de 4 brossettes » se lit comme le contenu d'un
paquet, pas comme un lot de 4. Les mots génériques (« unités », « pièces »)
sont ignorés : sur une lessive, « lot de 2 unités » compte des bouteilles. Quand
la fiche déclare autant d'articles que le titre annonce de pièces (« 8
brossettes », nombre d'articles : 8), seul le total est sûr — paquet de 8 ou 8
unités ? — et le nombre d'unités reste non établi (`pieces-or-pack`).

Sur un lot, un nombre de doses **unique** est refusé : les titres réels
l'écrivent tantôt par unité (« Le Chat 2L 40 lavages - Lot de 2 »), tantôt
pour le lot (« Persil 3 x 1L (60 lavages) »). Passent seulement « 3 x 40
tablettes » et la paire cohérente « 40 lavages … soit 80 lavages ».

### Traces d'extraction (`identityDiagnostics`)

Chaque relevé enregistre *comment* son identité a été lue : source de l'EAN
(`details` / `json-ld`), nombre de lignes de caractéristiques lues
(`detailEntries`) et leurs libellés normalisés (`detailLabels`, 40 au plus),
conteneurs connus présents dans la page (`detailContainers`), présence du mot
« EAN » et de « Nombre d'articles » dans le texte (hors scripts), nombre
d'articles déclaré et désaccord de conditionnement. Une couverture d'EAN
faible a deux causes aux remèdes opposés — l'enseigne ne publie pas l'EAN, ou
le scrapper ne sait plus le lire — et seules ces traces les distinguent. Le
rapport `python -m src.reports.identity_coverage` (pipeline) les exploite et
refuse de conclure quand la lecture est en panne.

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

Une fiche en **404 / 410** (ou affichant « page introuvable ») reçoit le même
traitement. Les autres pages sans titre sont diagnostiquées, voir ci-dessous.

## Pages illisibles : diagnostic et journal des échecs

Une fiche sans titre, ou une page de recherche sans résultat lisible, n'est plus
abandonnée en silence. Elle est **diagnostiquée** (`AmazonPageDiagnosis`, règles
pures testées) à partir de l'URL finale, du statut HTTP, de marqueurs de la page
(formulaire de captcha, squelette de fiche / de recherche) et, en dernier
recours, de son texte :

| Cause (`reason`) | Signe | Conséquence |
|---|---|---|
| `captcha` | `/errors/validateCaptcha`, `#captchacharacters`, « pas un robot », « continuer vos achats » | session retirée, nouvelle tentative |
| `sign_in` | redirection vers `/ap/signin`, `/ap/cvf` | session retirée, nouvelle tentative |
| `rate_limited` | HTTP 429 / 503, « une erreur s'est produite » | session retirée, nouvelle tentative |
| `http_error` | autre 4xx / 5xx | nouvelle tentative si 5xx |
| `empty_page` | HTML quasi vide | nouvelle tentative |
| `not_found` | HTTP 404 / 410, « page introuvable » | fiche marquée indisponible |
| `layout_changed` | squelette de fiche (ou de recherche) présent, sélecteurs muets | ignorée, **HTML conservé** — c'est le code à réparer |
| `no_results` | « Aucun résultat pour » | ignorée |
| `unknown` | rien de connu | nouvelle tentative, **HTML conservé** à l'abandon |
| `request_error` | la requête elle-même a échoué (délai, navigateur) | géré par Crawlee |

Les nouvelles tentatives sont celles de Crawlee (`maxRequestRetries`, 3 par
défaut) : un captcha passager ne coûte plus le relevé du jour.

Chaque échec (et chaque tentative) est écrit dans la collection
**`scrape_failures`** : URL demandée et finale, mot-clé, cause, issue
(`retried`, `gave_up`, `skipped`, `marked_unavailable`), numéro de tentative,
statut HTTP, titre de la page, début du texte visible, marqueurs, message
d'erreur. Le HTML complet n'est gardé que pour les causes incertaines
(`layout_changed`, `unknown`), à l'abandon, 5 pages par cause et par passage
au plus, compressé en gzip. Les documents expirent après 30 jours (index TTL).

Un **bilan par cause** termine chaque passage — dernière ligne du log de la
tâche `scrape` dans Airflow. Pour le détail :

```bash
npm run failures                       # bilan du dernier jour en échec + derniers échecs
npm run failures -- --day=2026-11-10   # un jour donné (UTC)
npm run failures -- --dump=<id>        # extrait le HTML conservé → scrape-failure-<id>.html
```

## Anti-détection

- `navigator.webdriver` masqué via un `preNavigationHook`
- `--disable-blink-features=AutomationControlled`
- empreinte de navigateur générée par le `browserPool` de Crawlee, **en français**
  (`AmazonBrowserLocale` : langue de l'empreinte `fr-FR` + `Accept-Language`).
  Sans ce réglage, l'empreinte annonce `en-US` (défaut de Crawlee) et amazon.fr
  sert titres et caractéristiques en anglais — mesuré sur 927 fiches sur 927
  le 10/11/2026. Les libellés d'identité restent reconnus dans les deux
  langues (« Number of items », « Brand Name », « Global Trade Identification
  Number »…), au cas où la préférence serait ignorée
- allure volontairement basse : `maxConcurrency: 2`, `maxRequestsPerMinute: 10`
- pool de sessions à cookies persistants (10 sessions, retirées après 50 usages
  ou 3 erreurs)
- défilement et temporisation aléatoires sur chaque fiche

## Scripts ponctuels

Hors du flux nominal, à lancer à la main :

```bash
npm run migrate:legacy-data          # devises symboliques → ISO, images en haute résolution
npm run migrate:reparse-quantities -- --all --dry-run   # puis sans --dry-run : recalcule le conditionnement de l'historique
npm run spike:jsonld -- --limit=30   # mesure ce qu'Amazon expose : JSON-LD, EAN, contenance
npm run failures                     # pages illisibles du dernier passage, par cause (lecture seule)
```

`migrate:reparse-quantities` est **à lancer une fois** après le déploiement de
la séparation unité / total, avant le `build_price_history` suivant : celui-ci
retient la dernière valeur d'identité *non nulle*, si bien qu'un ancien
`doses` que le parseur refuse désormais (`null`) ne serait jamais remplacé.
Avec `--all`, il recalcule **tous** les relevés avec le parseur actuel (titre +
« Nombre d'articles » conservé dans `identityDiagnostics`) : à relancer après
chaque changement de parseur qui refuse ce qu'il acceptait — par exemple
« Pack de 4 brossettes », lu comme un lot de 4 avant que les brossettes ne
soient reconnues. Seuls les relevés qui changent sont réécrits ; la simulation
(`--dry-run`) dit combien. Sans `--all`, seuls les relevés jamais migrés.
Dans l'image : `node dist/scripts/reparseQuantities.js --all`.

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

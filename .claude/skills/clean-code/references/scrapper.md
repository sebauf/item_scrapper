# Scrapper — Node.js + TypeScript, clean architecture, Crawlee / Playwright

## Frontières (à corriger si violées)

```
domain/          entités (Keyword, Product, TrackedUrl) + interfaces de repository
application/     use cases + port IShopScraper
infrastructure/  repositories MongoDB, crawler Amazon, parseurs
```

- `domain/` et `application/` n'importent ni `playwright`, ni `crawlee`, ni
  `mongodb`.
- `application/` dépend des interfaces (`I*Repository`, `IShopScraper`), jamais
  des classes `Mongo*` ou `Amazon*`. Le câblage se fait dans `main.ts`.
- Rien de spécifique à Amazon dans `scraping/shared/` : ces parseurs servent à
  toute future enseigne.

## Le découpage central : DOM d'un côté, règles de l'autre

Chaque lecture de fiche suit le même schéma, à respecter dans tout nouveau code :

| Côté DOM (`*Handler`, `*Extractor`) | Côté règles (`*Parser`, `shared/*`) |
|---|---|
| sélecteurs, appels Playwright, `page.$$eval` | fonctions **pures** : texte / objets → valeur métier |
| renvoie des chaînes et des listes brutes | décide, normalise, refuse |
| pas de test unitaire (navigateur requis) | test `*.spec.ts` à côté, sans navigateur ni réseau |

Exemples dans le dépôt : `AmazonProductPage` → `PriceParser`, `AmazonOfferParser`,
`AmazonUrl` (orchestrés par `AmazonProductHandler`) ;
`AmazonIdentityExtractor` → `AmazonIdentityCascade`, `AmazonIdentityParser`, `JsonLdParser`,
`QuantityParser`, `PackReconciler`, `Gtin`.

**Constat « à corriger »** : une regex, un seuil ou un choix métier écrit dans un
handler ou un extractor. Le déplacer dans le parseur et le tester.

## Règles propres au scrapper

- **Sélecteurs = constantes nommées**, groupées en tête de fichier, avec un
  commentaire disant quelle mise en page ils couvrent (`OWN_PRICE_CONTAINERS`,
  `DETAIL_BULLET_SELECTOR`). Pas de sélecteur littéral enfoui dans une fonction.
- **Portée des sélecteurs** : un sélecteur générique sur toute la page
  (`.a-price`) est un défaut de conception, pas un raccourci. Le prix d'un
  remplaçant ou d'un carrousel serait attribué au mauvais article.
- **Refuser plutôt que deviner** : un parseur renvoie `null` quand il n'est pas
  sûr (EAN à clé de contrôle invalide, conditionnement non établi). `null` est
  une réponse, pas une erreur : c'est ce qui protège la comparaison stricte
  `(ean, packSize)`.
- **Libellés bilingues** : les fiches peuvent arriver en anglais ; toute table
  de libellés couvre le français **et** l'anglais (`AmazonIdentityParser`).
- **Un parseur qui refuse ce qu'il acceptait** implique de relancer la migration
  `reparseQuantities --all` : le signaler dans le rapport si le diff touche
  `QuantityParser` ou `PackReconciler`.
- Les scripts (`src/scripts/`) sont des points d'entrée : ils réutilisent les
  parseurs, ils n'en réimplémentent pas, et ils crawlent avec
  `AMAZON_CRAWLER_OPTIONS` — un crawler réglé autrement est servi autrement
  (pages de blocage, fiches en anglais). Connexion par
  `MongoConnection.fromEnv()`.
- **Réglages liés** : `DEFAULT_MAX_REQUESTS_PER_CRAWL`,
  `KNOWN_PRODUCTS_LIMIT_PER_KEYWORD` (`AmazonCrawler`), `MAX_SEARCH_PAGES`
  (`AmazonSearchHandler`) et `MAX_REQUESTS_PER_MINUTE` voyagent avec la règle
  de fraîcheur, les quotas du backend et le délai de la tâche Airflow : en
  changer un, c'est relire les autres.

## Exceptions assumées propres au scrapper

| Ce qu'on voit | Pourquoi ne pas le « corriger » |
|---|---|
| Interfaces préfixées `I` (`IShopScraper`, `IKeywordRepository`) | Convention établie du composant (le backend ne l'a pas). Une notation hongroise, certes, mais renommer dans un diff partiel créerait deux styles. Ne la changer que dans une PR dédiée à tout le composant. |
| Fichiers en PascalCase (`AmazonCrawler.ts`) | Convention du composant ; le backend est en kebab-case. Suivre le style du composant où l'on écrit. |
| Imports avec extension `.js` dans du TypeScript | Exigé par la résolution de modules ESM de Node ; ne pas retirer. |
| Longs commentaires sur les pièges d'Amazon | Ils documentent des incidents réels (prix du remplaçant, `en-US` par défaut de Crawlee) ; c'est ce qui évite de les réintroduire. |

## Tests (`node:test`, `npm test`)

- Un parseur = un `*.spec.ts` à côté, nourri de **chaînes réelles** copiées des
  fiches (avec leurs caractères invisibles U+200E / U+200F, leurs espaces
  insécables), pas de chaînes « propres » inventées.
- Chaque bug corrigé ajoute le cas réel qui l'a révélé.
- Noms de tests en français : `it('accepte une valeur déjà formatée')`.

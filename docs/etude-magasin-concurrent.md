# Étude — ajouter un magasin concurrent et rapprocher les articles

> Statut : étude de conception, aucun code modifié.
> Objet : évaluer l'ajout d'une seconde enseigne au scrapper, et surtout
> déterminer **comment rapprocher deux fiches produit de deux magasins
> différents avec une fiabilité suffisante pour les comparer strictement**.

---

## 1. Résumé exécutif

**Ajouter un second magasin est techniquement peu coûteux. Rapprocher les
articles est le vrai sujet, et c'est un problème de *données*, pas de code.**

L'architecture actuelle est déjà prête à accueillir plusieurs boutiques :
le port `IShopScraper` ne parle ni d'Amazon ni d'URL, le champ `shop` existe
de bout en bout (entité `Product` → `items_raw` → `price_history` →
`ProductSummary` de l'API → frontend). Le coût d'un second crawler est celui
d'écrire ses sélecteurs CSS, pas celui de refondre l'architecture.

En revanche, rien dans le système ne sait aujourd'hui dire que *cette*
lessive Amazon et *cette* lessive Carrefour sont le même article. Il manque
un concept — le **produit canonique** — et les données qui permettent de
l'établir. Ces données (EAN, marque, contenance normalisée) **ne sont pas
extraites aujourd'hui**, y compris chez Amazon.

Trois conclusions à retenir :

1. **Le préalable n'est pas le second crawler, c'est l'enrichissement de
   l'extraction existante.** Extraire l'EAN, la marque et la contenance sur
   Amazon a de la valeur *même si le second magasin n'est jamais ajouté*
   (meilleurs prix unitaires, détection des variantes). C'est la phase 1.
2. **La comparaison stricte doit reposer sur une cascade à plusieurs niveaux
   de confiance, jamais sur un score de similarité unique.** L'EAN tranche
   quand il est présent ; sinon, marque + contenance + image ; sinon, file
   d'attente de validation humaine. Un rapprochement flou ne doit **jamais**
   alimenter un affichage « moins cher chez X ».
3. **La comparaison inter-magasins ne doit pas être fondue dans le
   `deal_score` actuel.** Ce score répond à « est-ce le bon *moment* ? ».
   La comparaison répond à « est-ce la bonne *enseigne* ? ». Ce sont deux
   axes indépendants ; les mélanger rend les deux illisibles.

---

## 2. Où en est le système aujourd'hui

### 2.1 L'identité d'un produit, c'est son URL

C'est le point structurant. Partout, un produit **est** une URL :

| Endroit | Clé |
|---|---|
| `items_raw` | index unique `{ url, day }` (`MongoConnection.ts:13`) |
| `price_history` | `_id = url` (`build_price_history.py`, `$group: {_id: "$url"}`) |
| `deal_scores` | `_id = url` (`score.py`, `UpdateOne({"_id": url}, …)`) |
| API backend | `ProductId` = base64url de l'URL (`product-id.ts`) |
| Frontend | reçoit `id` déjà encodé, ne sait rien de l'URL |

C'est un choix sain et il **n'est pas à remettre en cause** : une URL est un
identifiant naturel, stable et déjà canonicalisé (`/dp/ASIN/`). Il faut
simplement lui donner un nom exact : **cette clé identifie une *offre*, pas
un article.**

### 2.2 Le vocabulaire manquant

| Concept | Existe ? | Définition |
|---|---|---|
| **Offre** | ✅ implicitement | Ce qu'une enseigne vend, à une URL, à un prix, à une date. C'est exactement ce que contiennent `items_raw` / `price_history` / `deal_scores`. |
| **Produit canonique** | ❌ | L'article physique, indépendant de l'enseigne : *Lessive Ariel Original liquide 1,5 L*. Une même lessive vendue chez 3 enseignes = 1 produit canonique, 3 offres. |

Tout l'enjeu de l'étude tient dans la création de ce second concept et dans
la fiabilité du lien offre → produit canonique.

### 2.3 Ce que le scoring fait — et ne fait pas

Le pipeline compare **un produit à lui-même** et jamais à un autre. Les
docstrings l'écrivent trois fois (`score.py`, `features.py`) :

```
score = (prix attendu − prix constaté) / prix attendu × 100
prix attendu = moyenne glissante 30 j du produit lui-même
```

Conséquence immédiate et rassurante : **l'arrivée d'un second magasin ne
casse aucun calcul existant.** Chaque offre continue d'être scorée contre
son propre historique. Aucune migration de `price_history` ni de
`deal_scores` n'est nécessaire.

### 2.4 Ce qui est déjà multi-boutique

- `IShopScraper.scrape(keywords, trackedUrls)` — aucune mention d'Amazon.
- `Product.shop: string` — champ de premier ordre de l'entité domaine.
- `toProductSummary` expose `shop` au frontend (avec repli `'amazon'`).
- `build_price_history.py` remonte `shop` dans `price_history`.
- Le README scrapper documente déjà « Ajouter un crawler pour une nouvelle
  boutique ».

### 2.5 Ce qui casserait dès le second magasin

Trois points précis, à traiter avant tout ajout :

**(a) `findKnownUrlsByKeyword` n'est pas filtré par boutique** — *le piège
principal*.

```ts
// MongoProductRepository.ts:36
.find({ keyword }, { projection: { _id: 1 } })
```

Ce fichier relit `price_history` pour re-visiter les produits déjà connus.
Dès qu'une seconde enseigne écrit dans `price_history` avec le même
mot-clé, **le crawler Amazon recevra des URLs Carrefour à visiter**. Le
`PRODUCT_PATH_RE` (`/dp/[A-Z0-9]{10}`) d'`AmazonProductHandler` ne matchera
pas, `isDeadProductRedirect` renverra `false`, le titre ne sera pas extrait,
et la page sera silencieusement ignorée — en consommant le budget
`maxRequestsPerCrawl`. Dégradation silencieuse, la pire espèce.

→ La signature doit devenir `findKnownUrlsByKeyword(keyword, shop, limit)`
avec `.find({ keyword, shop })`.

**(b) `ProductUrl` refuse tout ce qui n'est pas `amazon.fr`**

```ts
// backend/src/modules/product-tracking/domain/product-url.ts:37
if (parsed.hostname !== 'amazon.fr' && parsed.hostname !== 'www.amazon.fr')
```

Le refus est volontaire et bien documenté (« refuser à la saisie plutôt
qu'à l'usage »). Il faut conserver ce principe mais le généraliser : un
registre de politiques d'URL par boutique (`AmazonUrlPolicy`,
`CarrefourUrlPolicy`), chacune sachant reconnaître et canonicaliser ses
propres URLs. Le point d'extension est propre ; c'est une réécriture de
~30 lignes.

**(c) Un seul scraper, sans isolation des pannes**

`ScrapeProductsUseCase` reçoit un `shopScraper` unique et propage son
exception. Avec deux enseignes, une erreur Carrefour (anti-bot, refonte du
site) ferait échouer toute la tâche Airflow et **coûterait aussi la journée
de données Amazon**. Il faut passer à `readonly IShopScraper[]`, exécuter
séquentiellement, et encapsuler chaque scraper dans un `try/catch` qui
journalise sans interrompre les suivants.

---

## 3. Le cœur du sujet : rapprocher les articles

### 3.1 Poser la bonne exigence

« Comparer strictement » impose une asymétrie de coût qu'il faut assumer
explicitement :

| Erreur | Coût |
|---|---|
| **Faux positif** (rapprocher deux articles différents) | Catastrophique. Le tableau annonce « 2,50 € chez X vs 12 € chez Y » alors qu'il s'agit d'un 1 L et d'un 5 L. La confiance dans l'outil est perdue d'un coup. |
| **Faux négatif** (ne pas rapprocher deux articles identiques) | Bénin. Une comparaison manque, l'utilisateur ne le voit même pas. |

→ **La métrique à optimiser est la précision, pas le rappel.** Cible
raisonnable : ≥ 99 % de précision sur les rapprochements auto-acceptés. Le
rappel peut rester à 50 % sans que le produit perde sa valeur.

Cette asymétrie justifie à elle seule l'architecture en cascade proposée
ci-dessous, plutôt qu'un modèle de similarité unique avec un seuil.

### 3.2 Les signaux d'identité, par ordre de fiabilité

#### Niveau 1 — identifiants durs (déterministe)

**EAN / GTIN-13** — le code-barres. C'est *la* réponse au problème : un
entier de 13 chiffres, universel, attribué par le fabricant, identique dans
toutes les enseignes du monde. Deux EAN égaux = même article, sans débat.

Disponibilité attendue (à mesurer, cf. §6) :

| Source | Où le trouver | Couverture attendue |
|---|---|---|
| Amazon | tableau « Informations sur le produit » (`#productDetails_techSpec_section_1`, `#detailBullets_feature_div`), ligne EAN/UPC | partielle — souvent absente en épicerie vendue par Amazon |
| Drives (Carrefour, Auchan, Leclerc) | souvent **dans l'URL elle-même**, et dans le JSON-LD `gtin13` | élevée |

**Le levier le plus rentable de toute l'étude : lire le JSON-LD.**
La plupart des sites marchands émettent, pour le SEO, un bloc
`<script type="application/ld+json">` de type `Product` qui normalise
`gtin13`, `brand`, `name`, `sku`, `mpn`, `offers.price`. Un seul parseur
partagé remplace des dizaines de sélecteurs CSS fragiles, **y compris chez
Amazon**. C'est aussi ce qui rend l'écriture du second crawler courte.

**MPN / référence fabricant** — deuxième meilleur identifiant, mais ne vaut
qu'associé à la marque (deux fabricants peuvent utiliser la même
référence).

#### Niveau 2 — attributs structurés

Décomposer le titre en champs comparables :

- `marque` — *Ariel*, *Le Chat*, *Finish*
- `gamme / parfum` — *Original*, *Lavande*, *Quantum Ultimate*
- `contenance` — normalisée en unité de base : **L**, **kg**, **doses**
- `conditionnement` — *lot de 3*, *×2*

**La normalisation de la contenance est le point technique décisif.** Elle
existe déjà à moitié : `parseUnitPrice` (`PriceParser.ts`) lit déjà les
`€/L`, `€/kg`, `€/100 ml` affichés par Amazon. Ce champ `unitPrice` est
précisément ce qui rend la comparaison honnête :

> Deux offres du même article en 1,5 L et en 3 L sont le **même produit
> canonique** mais pas la **même offre**. La comparaison stricte doit porter
> sur le **prix au litre** ; le prix absolu n'est comparable que lorsque le
> conditionnement est identique.

C'est une règle métier, au même titre que `DealPolicy`. Elle a donc sa place
dans le domaine, pas enfouie dans un parseur d'infrastructure.

#### Niveau 3 — signaux flous (jamais seuls, sous contrainte « strict »)

- **Similarité de titre normalisé** — repli des accents, minuscules,
  suppression des mots vides marchands (« lot de », « pack », « x2 »),
  puis `token_set_ratio` ou distance de Jaccard sur trigrammes.
- **Empreinte perceptuelle d'image (pHash / dHash)** — très efficace en
  grande consommation : les marques livrent le **même packshot** à toutes
  les enseignes. Peu coûteux, étonnamment discriminant, et les URLs
  d'images sont déjà collectées (`images[]`, déjà passées en haute
  résolution par `ImageUrlParser`).

### 3.3 L'algorithme recommandé : une cascade, pas un score

```
Pour chaque paire candidate (offre_A, offre_B) :

  ① Décision humaine enregistrée ?          → on la respecte, point final.
                                              (elle prime toujours)
  ② EAN_A et EAN_B présents et égaux ?      → EXACT     (confiance 1.00)
                                              auto-accepté
  ③ marque égale
     ET contenance normalisée égale (±1 %)
     ET (similarité titre ≥ seuil
         OU distance pHash ≤ seuil)          → PROBABLE  (confiance 0.7–0.95)
                                              → file de validation
  ④ sinon                                    → CANDIDAT  (confiance < 0.7)
                                              → jamais affiché comme
                                                comparaison stricte
```

**Règle de strictesse — la plus importante de l'étude :** seuls les
rapprochements `EXACT` et les `PROBABLE` **validés humainement** alimentent
l'écran « prix chez les autres marchands ». Les `CANDIDAT` peuvent au mieux
nourrir une section « produits similaires » explicitement étiquetée comme
telle.

**Le blocage (*blocking*) avant comparaison.** Ne jamais comparer toutes
les paires : c'est O(N²). Au volume actuel (~1 300 documents) c'est
indolore, à 100 000 ce ne l'est plus. On regroupe d'abord :
1. par `ean` (comparaison directe, pas de paire à former) ;
2. puis par `(marque, famille d'unité)` — on ne compare pas un article en
   litres avec un article en kilos ;
3. puis par `keyword` en dernier recours.

### 3.4 La validation humaine est un atout, pas un aveu d'échec

Le catalogue est petit et thématiquement resserré (lessive, adoucissant,
liquide de rinçage). Une page de curation listant les paires candidates
avec les **deux images côte à côte** et deux boutons *Valider* / *Rejeter*
résout la traîne à raison de quelques secondes par paire. C'est très
largement plus rentable que de tenter d'atteindre 99 % de précision par
l'algorithme seul.

Condition impérative : les décisions sont stockées dans une collection
distincte (`match_decisions`) et **le batch les respecte toujours**. Sinon
le travail humain est écrasé à chaque exécution du pipeline — c'est l'erreur
classique de ce type de système.

---

## 4. Impacts par composant

### 4.1 Scrapper

**Entité `Product`** (`domain/product/Product.ts`) — ajouter, tous
optionnels :

```ts
ean: string | null;          // GTIN-13 normalisé (13 chiffres)
brand: string | null;
mpn: string | null;
quantity: Quantity | null;   // { amount: number; unit: 'L' | 'kg' | 'dose' | 'unit' }
```

Nullables par nécessité : Amazon ne fournira pas toujours l'EAN. Le pipeline
de matching doit savoir fonctionner en information incomplète — c'est
d'ailleurs toute la raison d'être de la cascade.

**Réorganisation de `infrastructure/scraping/`**

Aujourd'hui tout vit sous `amazon/`, y compris des briques génériques :

```
scraping/
  shared/                 ← nouveau
    JsonLdParser.ts       — extrait Product{gtin13, brand, name, offers}
    PriceParser.ts        — déplacé depuis amazon/ (il est déjà générique)
    QuantityParser.ts     — "1,5 L" / "2×500 ml" / "30 lavages" → Quantity
  amazon/                 — inchangé pour l'essentiel + lecture du JSON-LD
  <concurrent>/           ← nouveau, même forme : Crawler / SearchHandler /
                            ProductHandler
```

Nuance de conception : `QuantityParser` produit la donnée sur laquelle
repose la comparabilité. On peut défendre que la **normalisation** (« 1,5 L
et 1500 ml sont la même contenance ») est une règle de domaine, et que seule
l'**extraction** (« où lire la chaîne dans le DOM ») relève de
l'infrastructure. C'est le même découpage que `DealPolicy` (domaine) vs
agrégations Mongo (infrastructure).

**Correctifs de portée boutique** — les trois points du §2.5.

**Budget de crawl.** `MAX_REQUESTS_PER_CRAWL` vaut 200 et
`maxRequestsPerMinute` 10 : un run complet est déjà de l'ordre de 20 min.
Deux enseignes en séquentiel doublent la fenêtre. À vérifier contre la
tolérance de la tâche Airflow avant la mise en production.

### 4.2 MongoDB — schéma

Aucune migration destructrice. Deux collections à créer :

**`product_matches`** — un document par produit canonique :

```js
{
  _id: "<canonicalId>",           // EAN si connu, sinon hash(marque|contenance|libellé)
  ean: "3014260610807" | null,
  brand: "Ariel",
  label: "Lessive liquide Original",
  quantity: { amount: 1.5, unit: "L" },
  offers: [
    { url: "https://www.amazon.fr/dp/B0…/", shop: "amazon",
      confidence: 1.0,  method: "ean",   decidedBy: "auto" },
    { url: "https://www.carrefour.fr/p/…", shop: "carrefour",
      confidence: 0.92, method: "attrs", decidedBy: "human" }
  ],
  suspect: false,                 // cf. garde-fou §6.2
  updatedAt: ISODate()
}
```

Le choix d'un tableau `offers[]` plutôt qu'un document par paire suit la
convention déjà retenue dans le dépôt (`price_history.history[]`) : c'est
la forme de **lecture** — l'écran de comparaison veut toutes les offres d'un
article d'un coup — et leur nombre par article reste minuscule.

**`match_decisions`** — les arbitrages humains, jamais écrasés par le batch :

```js
{ _id: "<urlA>|<urlB>", decision: "confirmed" | "rejected",
  decidedAt: ISODate(), reason: "contenances différentes" }
```

**Index à ajouter**

| Collection | Index | Raison |
|---|---|---|
| `items_raw` | `{ shop: 1, keyword: 1, day: -1 }` | listes et compteurs par enseigne |
| `price_history` | `{ keyword: 1, shop: 1, lastSeen: 1 }` | sert le `findKnownUrlsByKeyword` corrigé |
| `product_matches` | `{ "offers.url": 1 }` | offre → produit canonique en une requête |
| `product_matches` | `{ ean: 1 }` sparse | rapprochement déterministe |

### 4.3 Pipeline Python — c'est là que le matching doit vivre

Trois candidats possibles pour héberger le matching ; un seul tient :

| Emplacement | Verdict |
|---|---|
| Scrapper | ❌ Un crawler ne connaît que sa boutique. Il ne peut pas, par construction, rapprocher deux enseignes. |
| Backend | ❌ Charte de lecture seule sur ces collections ; et c'est un calcul par lots, pas une requête. |
| **Pipeline** | ✅ Déjà un batch pandas, déjà orchestré, déjà testé sur mongomock. |

```
pipeline/src/matching/
  normalize.py    — repli d'accents, marques, unités → forme comparable
  candidates.py   — blocage : ean, puis (marque, famille d'unité), puis keyword
  match.py        — la cascade, écrit product_matches, respecte match_decisions
```

**DAG Airflow** : `scrape >> refine >> match >> score`. Les deux backends
d'exécution (`DockerOperator` et `KubernetesPodOperator`) demandent chacun
leur définition de tâche.

**Testabilité** — argument fort en faveur de cet emplacement : le matching
est du Python pur sur des chaînes, donc trivial à tester. Le dépôt a déjà
`pytest` + `mongomock` et la convention explicite d'exécuter les vraies
agrégations en test. Les fixtures doivent contenir de **vrais titres
relevés**, pas des titres inventés — c'est la seule façon d'attraper les cas
réels (« LOT DE 2 », « format éco », « ×3 »).

**Ne pas toucher à `score.py`.** Voir §5.

### 4.4 Backend

**Nouveau contexte borné `modules/comparison/`** plutôt qu'une extension de
`catalog`. Justification DDD : `catalog` répond à « quel est le prix de
cette offre et son historique » ; la comparaison répond à « où cet article
est-il le moins cher » et introduit son propre vocabulaire (offre, produit
canonique, écart de prix). Coût assumé : un module de plus.

**Lecture** — `ProductComparison`, à partir d'un `ProductId` (donc d'une
offre) : retrouve le produit canonique via `offers.url`, renvoie toutes les
offres avec prix, prix unitaire, enseigne, fraîcheur du relevé, et l'écart
au moins cher. `ProductSummary` porte déjà `shop` : rien à y ajouter.

**Écriture** — c'est le premier read model du projet qui a de vrais
invariants, et il mérite donc un agrégat, contrairement aux lectures
existantes :

- une offre appartient à **au plus un** produit canonique ;
- une paire rejetée ne doit **jamais** être re-proposée ;
- on ne confirme pas un rapprochement entre deux offres de la même enseigne
  sans décision explicite.

Routes : `POST /api/v1/matches/{id}/confirm`, `POST .../reject`.

### 4.5 Frontend

| Écran | Changement |
|---|---|
| Fiche produit | Bloc « Chez les autres marchands » — point d'insertion naturel, réutilise l'`id` existant |
| `ProductCard` | Badge enseigne (tout est implicitement Amazon aujourd'hui) |
| Grille par mot-clé | **Décision à prendre** : regrouper par produit canonique (une carte, N prix) ou garder une carte par offre ? Sans regroupement, le même article apparaîtra deux fois. |
| `/matching` | File de validation : deux images côte à côte, Valider / Rejeter |

Rappel de la charte du dépôt : *« le frontend ne détient aucune règle
métier »*. Le regroupement par produit canonique est une décision
d'affichage métier → elle appartient au read model backend, qui renvoie une
structure déjà groupée.

### 4.6 MCP

Un outil `compare_product` renvoyant les offres en texte compact, dans la
lignée des six existants. Conserver l'`id` opaque dans la sortie, comme le
fait déjà `format.ts` — c'est la seule clé qui permet à l'agent d'enchaîner
sur `get_product`.

---

## 5. Comment articuler comparaison et scoring

**Recommandation : ne pas fondre la comparaison dans le `deal_score`.**

Le score actuel répond à une question temporelle : *« ce prix est-il bas par
rapport à l'histoire de ce produit ? »* — donc *est-ce le bon moment
d'acheter ?* La comparaison répond à une question concurrentielle : *« cet
article est-il moins cher ailleurs ? »* — donc *est-ce la bonne enseigne ?*

Ces deux axes sont **indépendants** et les quatre combinaisons ont un sens :

| | Moins cher que sa propre moyenne | Au-dessus de sa moyenne |
|---|---|---|
| **Moins cher que la concurrence** | achat évident | l'enseigne reste la moins chère, mais attendre |
| **Plus cher que la concurrence** | promo qui ne rattrape pas l'écart | à éviter |

Les fusionner en un chiffre unique détruirait cette lecture. On expose donc
un **second signal distinct**, par exemple `priceGapPct` : écart au prix
unitaire de la meilleure offre concurrente. C'est à la fois plus lisible
pour l'utilisateur et un changement bien plus petit à implémenter —
`score.py` et `deal_scores` restent intacts.

---

## 6. Choisir le magasin, et le valider

### 6.1 Critères de choix

1. **Recouvrement de catalogue.** Les mots-clés suivis sont de la grande
   consommation (`lessive liquide`, `adoucissant`, `liquide de rincage
   finish`). Le recouvrement est maximal avec les drives alimentaires
   (Carrefour, E.Leclerc, Intermarché, Auchan) et faible avec un
   généraliste non alimentaire.
2. **EAN exposé.** C'est ce qui décide si le matching est un problème résolu
   ou un projet de recherche.
3. **Scrapabilité — attention au prix par magasin.** Un drive affiche des
   prix **dépendants du point de vente** : la donnée n'est plus
   `(produit, jour)` mais `(produit, magasin, jour)`. Deux options : figer
   un magasin unique en configuration (simple, suffisant pour une v1, à
   documenter clairement), ou ajouter une dimension `store` — ce qui
   impacterait la clé d'unicité de `items_raw` et donc `price_history`.
   **Recommandation v1 : figer un magasin.**
4. **Posture anti-bot.** Amazon nécessite déjà toute la panoplie
   (`navigator.webdriver` masqué, session pool, scroll humain). Les drives
   sont fréquemment derrière des protections plus agressives.

### 6.2 Piste privilégiée, à confirmer

**Carrefour (drive / courses)** semble le meilleur premier candidat :
recouvrement fort sur la grande consommation, EAN habituellement présent
dans l'URL et le JSON-LD. Repli possible : Auchan, ou Cdiscount si le
catalogue suivi s'élargit hors alimentaire.

**Réserve honnête : ces attentes n'ont pas été mesurées.** Aucune page n'a
été consultée pour cette étude. Le go/no-go réel tient en une journée de
*spike* :

> Relever manuellement ~20 fiches produit sur 2 ou 3 enseignes candidates,
> et mesurer : présence du JSON-LD, taux de présence de l'EAN, stabilité de
> l'URL, comportement face à un navigateur headless, dépendance au magasin.

Ce chiffre de couverture EAN détermine tout le reste : à 80 %, le matching
est essentiellement résolu ; à 20 %, il faut investir massivement dans le
niveau 2 et la validation humaine.

### 6.3 Garde-fous qualité

**Jeu de référence (*gold set*).** 100 à 200 paires étiquetées à la main,
**versionnées dans le dépôt** en fixture de test. Mesurer précision et
rappel à chaque modification de l'algorithme. Sans ce jeu, la qualité du
matching dérive silencieusement et personne ne le voit.

**Alerte automatique sur écart de prix unitaire.** Deux offres rapprochées
dont les **prix au litre** diffèrent de plus de ~40 % sont presque toujours
un mauvais rapprochement (contenance mal lue, article différent). Ce test
est trivial à écrire, ne coûte rien, et attrape la majorité des faux
positifs. → champ `suspect: true`, exclu de l'affichage, versé dans la file
de validation.

---

## 7. Risques

| Risque | Gravité | Atténuation |
|---|---|---|
| Faux positifs de rapprochement | **Élevée** — perte de confiance immédiate | Cascade + précision ≥ 99 % + garde-fou prix unitaire + validation humaine |
| Anti-bot du nouveau site | Élevée | Isolation par scraper (§2.5c) : une panne Carrefour ne doit pas coûter la journée Amazon |
| Prix dépendant du magasin (drive) | Moyenne | V1 : figer un magasin, le documenter |
| Dérive silencieuse du matching | Moyenne | Gold set exécuté en CI (`pipeline.yml` fait déjà échouer le build sur suite rouge) |
| Volume | Moyenne | Déjà signalé en commentaire dans `mongo-dashboard.read-model.ts` : les agrégations balaient tout `items_raw` (« ~1300 documents… premier point à optimiser »). Une seconde enseigne double le volume et le matching ajoute un `$lookup`. |
| Conditions d'utilisation | À arbitrer | Hors périmètre technique — décision produit |

---

## 8. Feuille de route proposée

**L'ordre compte plus que le contenu de chaque phase.**

| Phase | Contenu | Pourquoi à ce rang |
|---|---|---|
| **0 — Spike** (~1 j) | Relever 20 fiches sur 2-3 enseignes ; mesurer JSON-LD, EAN, dépendance magasin | Go/no-go et choix de l'enseigne. Tout le reste dépend du taux de couverture EAN. |
| **1 — Enrichir l'extraction Amazon** | `JsonLdParser`, `QuantityParser`, champs `ean`/`brand`/`quantity` ; déplacement vers `scraping/shared/` | **Apporte de la valeur seule**, même si le magasin n'est jamais ajouté. Testable isolément. Prérequis absolu du matching. |
| **2 — Second crawler** | `<concurrent>Crawler` + les 3 correctifs de portée boutique (§2.5) | Sans la phase 1, on obtient deux silos sans lien. |
| **3 — Étage de matching** | `pipeline/src/matching/`, `product_matches`, gold set, DAG mis à jour | Sans gold set, la qualité est invérifiable. |
| **4 — Exposition** | Module `comparison` backend, bloc fiche produit, badge enseigne, outil MCP | La donnée doit exister avant d'être affichée. |
| **5 — Curation** | `match_decisions`, écran `/matching`, routes confirm/reject | Traite la traîne que l'algorithme ne tranchera jamais seul. |

---

## 9. Décisions à arbitrer avant de coder

1. **Quelle enseigne ?** — tranché par le spike de phase 0.
2. **Grille par mot-clé : regrouper par produit canonique, ou une carte par
   offre ?** Le regroupement est plus juste mais change la pagination et les
   compteurs (`keywordTotal`, `keywordDealCount`).
3. **La comparaison alimente-t-elle le `deal_score` ?** Recommandation :
   non, signal séparé (§5).
4. **Prix par magasin : figer un point de vente, ou modéliser la
   dimension ?** Recommandation : figer en v1.
5. **Quel niveau d'automatisation accepte-t-on ?** Recommandation :
   auto-acceptation sur EAN uniquement ; tout le reste passe par validation
   humaine tant que le gold set n'a pas démontré ≥ 99 % de précision sur le
   niveau 2.

---

## 10. Ce qu'il faut retenir

- L'architecture supporte déjà plusieurs boutiques ; **trois correctifs
  précis** (§2.5) suffisent à la rendre réellement multi-enseigne, et le
  filtrage manquant par `shop` dans `findKnownUrlsByKeyword` est le piège
  le plus coûteux car il échoue en silence.
- **Le rapprochement n'est pas un problème d'algorithme, c'est un problème
  de données** : sans EAN ni contenance normalisée, aucun algorithme ne
  sauvera la comparaison. D'où la phase 1 avant tout ajout de magasin.
- **La strictesse se construit par l'asymétrie** : auto-accepter uniquement
  le déterministe, faire valider le reste, et ne jamais laisser un
  rapprochement flou atteindre l'écran.
- **Deux questions, deux signaux** : le bon moment (score existant), la
  bonne enseigne (nouvel écart de prix). Ne pas les mélanger.

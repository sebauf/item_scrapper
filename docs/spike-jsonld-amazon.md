# Spike — extraction d'identité produit chez Amazon (JSON-LD & caractéristiques)

> Rattaché à la phase 1 de `docs/etude-magasin-concurrent.md`.
> Question posée : **peut-on extraire d'une fiche Amazon de quoi rapprocher
> l'article avec la même référence chez une autre enseigne ?**

---

## 1. Ce qui a été fait, et ce qui n'a pas pu l'être

| Volet | État |
|---|---|
| Analyse structurelle des sources d'identité d'une fiche Amazon | ✅ fait |
| Prototype d'extraction (JSON-LD, caractéristiques, contenance) | ✅ fait, testé — 48 tests verts |
| Harnais de mesure exécutable sur un échantillon réel | ✅ livré (`npm run spike:jsonld`) |
| **Mesure du taux de couverture réel de l'EAN** | ❌ **impossible ici** |

**La mesure manque, et c'est le chiffre qui décide de la suite.** L'environnement
d'exécution de cette session refuse les connexions sortantes vers
`www.amazon.fr` (politique réseau : `CONNECT` rejeté en 403 par la passerelle).
Il n'y a par ailleurs ni MongoDB ni Docker disponibles ici, donc aucun corpus de
titres réels à analyser hors ligne.

Le spike livre donc **le harnais plutôt que le chiffre** : une commande à lancer
là où Amazon est joignable (votre poste, ou le cluster), qui produit le tableau
de couverture en quelques minutes. Tout le reste — la logique d'extraction, ses
garde-fous, ses tests — est complet et vérifié.

---

## 2. Résultat structurel : le JSON-LD n'est probablement pas la voie *chez Amazon*

C'est la principale correction que le spike apporte à l'étude.

L'étude affirmait que lire le JSON-LD était « le levier le plus rentable », en
rangeant Amazon parmi les sources à couverture « partielle ». En regardant
précisément comment une fiche Amazon est bâtie, la nuance est plus forte que
cela :

| Source | Chez Amazon | Chez un distributeur alimentaire |
|---|---|---|
| `<script type="application/ld+json">` de type `Product` avec `gtin13` | **rare** — Amazon publie surtout du JSON-LD de navigation (`BreadcrumbList`) et d'avis (`AggregateRating`) | **courant** — fiche `Product` complète, SEO oblige |
| Tableau « Informations sur le produit » (`#detailBullets_feature_div`, `#productDetails_*`) | **voie principale** — c'est là que vit l'EAN quand il existe | secondaire |

**Conséquence sur l'implémentation** : la cascade d'identité n'a pas le même
ordre selon l'enseigne. Chez Amazon elle interroge les caractéristiques ; chez
le concurrent, vraisemblablement le JSON-LD d'abord. C'est exactement pourquoi
le code livré sépare :

- des **parseurs partagés**, sans dépendance et agnostiques de la boutique
  (`scraping/shared/`) ;
- un **extracteur par enseigne** qui décide de l'ordre de la cascade
  (`scraping/amazon/AmazonIdentityExtractor.ts`).

Le JSON-LD reste donc un investissement justifié — mais c'est un investissement
**pour le futur concurrent**, pas pour Amazon. Il est écrit, testé, et prêt à
servir le jour où le second crawler arrive. Chez Amazon, il ne sert que de
filet de sécurité.

> Réserve : ces deux lignes sont des attentes fondées sur la structure connue
> des pages, pas des mesures. Le harnais les confirmera ou les démentira — il
> compte séparément les EAN issus du JSON-LD et ceux issus des
> caractéristiques (`eanSource`), précisément pour trancher ce point.

---

## 3. Ce qui a été construit

Cinq modules, tous couverts par des tests, aucun branché en production pour
l'instant — un spike ne modifie pas le pipeline de collecte.

```
scrapper/src/infrastructure/scraping/
  shared/                         ← agnostique de la boutique, sans dépendance
    Gtin.ts                       normalisation + clé de contrôle GTIN
    JsonLdParser.ts               <script ld+json> → { gtin, brand, mpn, sku, price }
    QuantityParser.ts             titre → contenance ramenée au litre / kilo
  amazon/
    AmazonIdentityParser.ts       caractéristiques → { ean, brand, mpn, asin }  (pur)
    AmazonIdentityExtractor.ts    sélecteurs Playwright + ordre de la cascade
scrapper/src/scripts/
    spikeJsonLd.ts                harnais de mesure
```

Le découpage « pur / DOM » reprend celui qui existe déjà entre `PriceParser` et
`AmazonProductHandler` : toute la logique se teste sans navigateur, ce qui rend
la suite exécutable en CI sans Playwright.

### 3.1 Les garde-fous, qui sont le vrai contenu du spike

Extraire est facile ; **ne pas extraire de travers** est le sujet. Chaque
garde-fou ci-dessous répond à un cas qui produirait un faux rapprochement,
c'est-à-dire l'erreur que l'étude a désignée comme inacceptable.

| Garde-fou | Ce qu'il empêche |
|---|---|
| **Clé de contrôle GTIN** (`Gtin.ts`) | Une référence fabricant numérique prise pour un code-barres. Une suite de 13 chiffres au hasard n'a qu'1 chance sur 10 de passer. |
| **Nettoyage des marques directionnelles** | Amazon écrit réellement `EAN‏ : ‎3014260610807`, avec des caractères U+200E/U+200F invisibles. Sans nettoyage, la valeur n'est pas un nombre et le libellé n'apparie pas. |
| **Refus des EAN multiples** | Sur un lot, Amazon liste plusieurs codes. En choisir un désignerait le mauvais article : on renvoie `null` et on lève `ambiguousEan`. |
| **Refus des titres à contenances multiples** | « Coffret Lessive 1 L + Adoucissant 750 ml » n'a pas *une* contenance. On refuse plutôt que de deviner. |
| **UPC-12 préfixé d'un zéro** | Un UPC relevé chez une enseigne et l'EAN-13 correspondant chez une autre sont le même article ; sans normalisation ils resteraient étrangers. |
| **GTIN-14 de regroupement rejeté** | Un carton de 6 n'est pas l'unité consommateur. Seul l'indicateur `0` est accepté. |
| **Frontière de mot sur les unités** | Sans elle, le « l » de « liquide » devient un litre et le « g » de « gouttes » un gramme. |
| **JSON-LD mal formé avalé** | Un bloc cassé ne doit jamais interrompre un scrape ; au pire la fiche ressort sans identifiant. |

### 3.2 Couverture de test

```
$ cd scrapper && npm test
# tests 48   # pass 48   # fail 0
$ npm run typecheck   # aucune erreur
$ npm run build       # OK
```

Le scrapper n'avait aucune suite de tests (`scrapper.yml` était le seul
workflow sans job `test`). Elle utilise `node --test --import tsx` et des
fichiers `*.spec.ts`, **exactement la convention déjà en place dans `mcp/`** —
zéro dépendance ajoutée. Le workflow `scrapper.yml` a été aligné sur les
autres : job `test` (typecheck + tests), déclaré en `needs:` du
`build-and-push`, et déclenchement sur pull request.

Les fixtures reprennent des formes réelles de titres de grande consommation
(`SKIP ACTIVE CLEAN 3,25L`, `Le Chat Bébé Lessive Liquide 2L - Lot de 2`,
`Persil 3 x 1L`, `Ariel 3en1 Pods`). Des titres inventés « propres »
donneraient une confiance trompeuse : ce sont les formes tordues qui cassent
un parseur.

---

## 4. Obtenir le chiffre manquant

Sur une machine ayant accès à Amazon :

```bash
cd scrapper
npm install
npx playwright install chromium     # si ce n'est pas déjà fait

# Échantillon aléatoire de 30 produits déjà suivis (nécessite MONGODB_URI)
npm run spike:jsonld -- --limit=30

# Ou sans base, depuis une liste d'URLs (une par ligne)
npm run spike:jsonld -- --urls=mes-urls.txt --out=rapport.json
```

Le script **ne modifie aucune collection** : il lit `price_history` pour tirer
son échantillon, visite les fiches, et écrit un relevé JSON local. Il reprend
la configuration anti-détection d'`AmazonCrawler` (concurrence 1, 10
requêtes/minute) — sans elle, la mesure porterait sur des pages de blocage.

Sortie attendue :

```
=== Spike extraction d'identité Amazon ===
Pages visitées : 30  |  bloquées/vides : 1

Page exploitable (titre extrait)              29   100 %
  dont au moins un bloc JSON-LD               ..    .. %
  dont un nœud JSON-LD de type Product        ..    .. %
  dont un GTIN dans le JSON-LD                ..    .. %
EAN vérifié, toutes sources                   ..    .. %
  provenant du JSON-LD                        ..    .. %
  provenant des caractéristiques              ..    .. %
  écarté car plusieurs EAN sur la fiche       ..    .. %
Marque                                        ..    .. %
Contenance normalisée depuis le titre         ..    .. %
...
Rapprochement déterministe possible (EAN)      : .. %
Rapprochement possible EAN ou marque+contenance: .. %
```

La ligne « bloquées/vides » mérite attention : si elle dépasse quelques
pourcents, Amazon sert des captchas et **la mesure n'est pas représentative**
— relancer plus lentement avant de conclure.

---

## 5. Comment lire le résultat

Le chiffre décisif est **« Rapprochement déterministe possible (EAN) »**.

| Couverture EAN | Lecture | Suite à donner |
|---|---|---|
| **≥ 60 %** | Le rapprochement est essentiellement résolu | Aller directement au second crawler. Validation humaine réservée à la traîne. |
| **25 – 60 %** | Cas le plus probable | Cascade complète indispensable : EAN sur la partie haute, marque + contenance sur le reste, file de validation. C'est le scénario que l'étude décrit. |
| **< 25 %** | L'EAN n'est pas exploitable chez Amazon | Deux options : faire porter l'identité par le **concurrent** (si *lui* publie l'EAN, on rapproche par marque + contenance + image depuis son côté), ou renoncer à la comparaison stricte sur les catégories concernées. **Ne pas compenser en abaissant les seuils** : ce serait échanger la précision contre de la couverture, exactement l'inverse de ce que « strict » exige. |

La seconde ligne — « EAN ou marque + contenance » — donne le plafond
atteignable en incluant la validation humaine. L'écart entre les deux lignes
**est** la charge de curation à prévoir.

---

## 6. Ce que le spike ne dit pas

- **Rien sur le concurrent.** Mesurer la couverture EAN côté Amazon ne dit
  rien de Carrefour ou Auchan. Le spike de phase 0 de l'étude reste à faire,
  et les parseurs partagés livrés ici le rendront rapide.
- **Rien sur la qualité du rapprochement lui-même.** Extraire un EAN n'est pas
  rapprocher. Le jeu de référence (100–200 paires étiquetées) reste le seul
  moyen de mesurer précision et rappel, et il ne peut être construit qu'une
  fois deux enseignes collectées.
- **Rien sur la stabilité dans le temps.** Les sélecteurs d'Amazon bougent. Un
  suivi du taux d'extraction, run après run, est le signal d'alerte à mettre en
  place quand l'extraction passera en production.

---

## 7. Prochaine étape recommandée

1. Lancer `npm run spike:jsonld -- --limit=30` et lire la ligne EAN.
2. Selon le résultat (§5), décider si l'on branche l'extraction en production —
   c'est-à-dire ajouter `ean` / `brand` / `quantity` à l'entité `Product`,
   appeler `extractAmazonIdentity` depuis `AmazonProductHandler`, et remonter
   ces champs dans `price_history` via `build_price_history.py`.
3. Ce branchement n'a de sens qu'après la mesure : si la couverture est
   très faible, il faudra d'abord revoir d'où vient l'identité.

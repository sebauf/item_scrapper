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
| Branchement de l'extraction dans la collecte (§7) | ✅ fait |
| **Mesure du taux de couverture réel de l'EAN** | ❌ **impossible ici** — se lit en base après quelques scrapes (§8) |

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

Cinq modules, tous couverts par des tests, désormais branchés dans la
collecte (cf. §7).

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

## 7. Suite donnée : l'extraction est branchée en production

Le harnais ne pouvant pas être exécuté ici, l'extraction a été **branchée dans
le pipeline de collecte**, ce qui rend la mesure gratuite : chaque scrape
nocturne enregistre désormais l'identité, et la couverture se lit directement
en base (§8) sur le corpus réel plutôt que sur un échantillon de 30 fiches.

Le branchement est sans risque : les champs sont facultatifs, une extraction
qui échoue écrit `null`, et rien en aval ne les lit encore. Le backend ne les
expose pas (c'est la phase 4 de l'étude), et son mappeur liste explicitement
les champs qu'il projette — un ajout de colonne lui est donc inerte.

| Fichier | Changement |
|---|---|
| `scrapper/src/domain/product/Product.ts` | `ean`, `brand`, `mpn`, `quantity`, `packSize`, `doses` — tous nullables |
| `scrapper/…/amazon/AmazonProductHandler.ts` | appelle `extractAmazonIdentity`, journalise les deux refus d'identité |
| `pipeline/src/refine/build_price_history.py` | remonte l'identité sur le document produit |

### La règle « dernière valeur non nulle »

Un point de conception mérite d'être signalé, parce qu'il n'était pas dans
l'étude et qu'il porte sur le champ dont tout dépend.

Les métadonnées existantes (`title`, `images`) sont agrégées avec `$last` : un
produit renommé ou re-photographié doit afficher sa version du jour. Appliquer
la même règle à l'EAN serait une faute. Amazon rend régulièrement une page
amputée de sa section « Informations sur le produit » — et un `$last` naïf
effacerait alors le code-barres du produit, c'est-à-dire **sa seule clé de
rapprochement**, à cause d'un unique relevé dégradé.

Les champs d'identité sont donc réduits à leur **dernière valeur renseignée**.
Un article ne change pas de code-barres ; son absence signale une page
dégradée, pas un changement d'article. Une correction ultérieure écrase bien
la valeur précédente — « dernière non nulle », pas « première ».

Quatre tests couvrent ce comportement, dont le cas réel de la migration : les
~1300 relevés déjà en base n'ont aucun champ d'identité et doivent ressortir à
`null` *présent*, pas absent, pour que l'étage de rapprochement n'ait pas à
distinguer « inconnu » de « pas encore relevé ».

---

## 8. Mesurer la couverture sur le corpus réel

Une fois quelques scrapes passés, le chiffre décisif se lit **dans la base**,
sans harnais et sans une seule requête de plus vers Amazon :

```bash
cd pipeline
MONGODB_URI=mongodb://<hôte>:<port> python -m src.reports.identity_coverage
python -m src.reports.identity_coverage --all     # inclut les fiches non relues
python -m src.reports.identity_coverage --json    # pour archiver la mesure
```

Dans le cluster, depuis l'image du pipeline (publiée sur `main`), avec les
mêmes variables que les tâches Airflow :

```bash
IMAGE=ghcr.io/<owner>/<repo>-pipeline:main
kubectl -n price-tracker run identity-report --rm -i --restart=Never \
  --image="$IMAGE" \
  --overrides='{"spec":{"imagePullSecrets":[{"name":"ghcr-pull-secret"}],
    "containers":[{"name":"identity-report","image":"'"$IMAGE"'",
    "imagePullPolicy":"Always",
    "command":["python","-m","src.reports.identity_coverage"],
    "envFrom":[{"secretRef":{"name":"price-tracker-secrets"}}]}]}}'
```

> **`imagePullPolicy` doit être dans l'override, pas en option.**
> `kubectl run --overrides` applique un *merge patch* JSON : la liste
> `containers` de l'override **remplace** celle que génère `kubectl`, et un
> `--image-pull-policy=Always` passé en option disparaît avec elle. Le
> conteneur retombe alors sur `IfNotPresent` et exécute l'image `:main`
> **en cache sur le nœud** — celle du dernier scrape, pas celle qui vient
> d'être publiée. Vécu le 10/11/2026 : une migration `--all` a examiné
> « 0 relevé » parce qu'elle tournait dans une image antérieure à `--all`.
> Repère : la migration à jour affiche `Relevés examinés (tous les relevés)`,
> le rapport à jour se termine par « Traces d'extraction — dernier passage ».

Le rapport (`pipeline/src/reports/identity_coverage.py`, lecture seule)
applique la règle de fraîcheur des écrans — seules comptent les offres relues
au dernier passage — et donne :

- la couverture de chaque champ d'identité, dont le **nombre d'unités établi** ;
- la répartition en trois classes qui partitionnent le catalogue :
  ① **clé stricte (EAN + nombre d'unités)**, ② sans EAN mais marque + lot +
  mesure unitaire (rapprochable *après validation humaine* : c'est la charge
  de curation), ③ non comparable ;
- le verdict de la grille du §5, appliquée à ① et non plus à l'EAN seul ;
- le détail par mot-clé ;
- les **EAN portés par plusieurs fiches Amazon** avec des nombres d'unités
  différents, exemples à l'appui — la preuve, chez une seule enseigne, qu'un
  rapprochement sur l'EAN seul confondrait une bouteille et un lot ;
- les **traces d'extraction** du dernier passage (`items_raw.identityDiagnostics`) :
  source de chaque EAN, part des fiches dont les caractéristiques ont été lues,
  fiches qui affichaient « EAN » sans qu'il soit lu, conteneurs et libellés
  rencontrés. Sous 50 % de caractéristiques lues, ou sans trace, le rapport
  rend **« non concluant »** au lieu d'un verdict.

> **Première mesure réelle (11/2026)** : 845 offres, EAN 10,5 %, marque
> 10,5 % — les mêmes fiches —, référence fabricant 0 %. La signature d'une
> section de caractéristiques jamais lue (tout venait du JSON-LD), pas d'un
> Amazon qui ne publierait pas l'EAN. C'est ce constat qui a motivé les
> traces d'extraction : sans elles, le rapport concluait « insuffisant ».

> La requête mongosh qui figurait ici mesurait l'EAN seul. Elle surestime ce
> qui est comparable strictement : un EAN sans nombre d'unités établi peut
> désigner un lot constitué par le vendeur (cf. `scrapper/README.md`,
> section *Identité*). Le rapport la remplace.

Le harnais `npm run spike:jsonld` reste utile pour ce que la base ne dit pas :
**d'où** vient l'EAN (JSON-LD ou caractéristiques) et si « Nombre d'articles »
est publié — il visite des fiches, la base non.

Attendre au moins deux ou trois scrapes **après le déploiement** de la lecture
du nombre d'unités (et la migration `migrate:reparse-quantities`) avant de
conclure : sur un seul run, les pages bloquées tirent le taux vers le bas, et
les relevés antérieurs n'ont pas de « Nombre d'articles ».

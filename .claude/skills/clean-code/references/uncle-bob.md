# Principes d'Uncle Bob — grille de relecture

Grille tirée de *Clean Code* (Robert C. Martin, 2008), chapitre par chapitre.
**Elle s'applique à chaque revue**, en plus de la référence du module. Chaque
constat du rapport cite son principe : `(ch. 3 — un seul niveau d'abstraction)`.

Ordre de priorité quand deux règles se contredisent :
1. les **exceptions assumées** de `SKILL.md` (contraintes techniques documentées) ;
2. les règles de la référence du module (frontières de couches) ;
3. cette grille.

Les seuls écarts au livre sont signalés **⚠ Adaptation** ci-dessous, avec leur
raison. Tout le reste s'applique tel quel.

---

## Ch. 2 — Noms significatifs

- **Révéler l'intention** : le nom dit pourquoi la chose existe, ce qu'elle
  fait, comment on s'en sert. `elapsedTimeInDays`, pas `d`.
- **Éviter la désinformation** : pas de `stationList` pour un `Map`, pas deux
  noms presque identiques pour deux choses différentes.
- **Distinctions significatives** : `ProductData` / `ProductInfo` ne disent pas
  ce qui les sépare. Pas de suffixe de bruit (`Data`, `Info`, `Manager`, `Helper`).
- **Prononçable et cherchable** : pas d'abréviation maison ; une constante plutôt
  qu'un littéral qu'on ne peut pas `grep`.
- **Pas d'encodage** dans le nom (type, portée). ⚠ Adaptation : le préfixe `I`
  des interfaces du scrapper est une convention existante du composant, voir
  `scrapper.md`.
- **Classes = noms, méthodes = verbes** : `KeywordQuota`,
  `assertCanTrackOneMore()`.
- **Un mot par concept** : ne pas mélanger `fetch`, `get`, `load`, `retrieve`
  pour la même opération dans un même module.
- **Noms du domaine** quand ils existent (relevé, conditionnement, rupture),
  noms techniques sinon (`*Repository`, `*Mapper`, `*Parser`).
- **Longueur proportionnelle à la portée** : `i` dans une boucle de trois lignes,
  `PRESUMED_SHORTAGE_MAX_DAYS` pour une constante de module.

## Ch. 3 — Fonctions

- **Petites.** Martin : « rarement plus de 20 lignes ».
  ⚠ Adaptation, **signal et non règle** : au-delà de ~20 lignes de logique
  (hors commentaires, signature et lignes vides), la fonction **doit être
  examinée** ; la garder telle quelle demande une raison explicite dans le
  rapport (elle se lit d'un bloc, un découpage disperserait une seule idée).
  Exemptées : les agrégations Mongo et les définitions déclaratives (schémas
  zod, enregistrement d'outils MCP, tables de sélecteurs), qui se lisent comme
  une liste.
- **Blocs et indentation** : le corps d'un `if` / `while` tient idéalement en un
  appel de fonction bien nommé ; plus de deux niveaux d'indentation est un
  signal.
- **Faire une seule chose** : test pratique — si l'on peut extraire de la
  fonction une autre fonction dont le nom n'est pas une simple reformulation,
  elle fait plus d'une chose.
- **Un seul niveau d'abstraction par fonction** : ne pas mêler orchestration
  (« lire la fiche, décider du prix ») et détail (regex, sélecteur CSS, index de
  tableau). Exemple du dépôt : `TrackKeywordCommand.execute` orchestre, les
  règles sont dans `KeywordName`, `Keyword`, `KeywordQuota`.
- **Règle de la descente (*stepdown rule*)** : le fichier se lit de haut en bas,
  chaque fonction suivie de celles, d'un niveau plus bas, qu'elle appelle. La
  fonction publique en haut, ses auxiliaires en dessous.
  ⚠ En Python, les constantes et imports restent en tête de module, et une
  fonction auxiliaire peut être définie après son appelant sans problème.
- **`switch`** : acceptable s'il n'apparaît **qu'une fois** pour un type donné
  et qu'il est exhaustif (union TypeScript). Le **même** `switch` répété à
  plusieurs endroits appelle une table (`Record<Level, string>`, comme
  `RESTOCK_LEVEL_LABELS` dans `frontend/src/lib/fuel.ts`) ou du polymorphisme.
- **Noms descriptifs** : un nom long et clair vaut mieux qu'un nom court et un
  commentaire.
- **Arguments** : 0 idéal, 1 ou 2 courants, 3 à justifier, au-delà un objet
  nommé. Pas d'**argument drapeau** (`render(isPrint)` → deux fonctions). Pas
  d'**argument de sortie** (une fonction qui modifie l'objet reçu au lieu de
  renvoyer un résultat) : renvoyer la valeur, ou en faire une méthode de cet
  objet.
- **Pas d'effet de bord caché** : le nom dit tout ce que fait la fonction. Une
  `parseX` qui écrit en base ou journalise une donnée personnelle ment.
- **Séparer commande et requête** : une fonction modifie l'état **ou** renvoie
  une information, pas les deux. Côté backend, c'est la séparation
  `commands/` / `queries/`.
- **Exceptions plutôt que codes d'erreur**, et **extraire les `try/catch`** dans
  une fonction dont c'est la seule tâche (exemple : `runTool` dans
  `mcp/src/tools/tool-result.ts`). ⚠ Exceptions assumées aux frontières, voir
  `SKILL.md`.
- **Ne pas se répéter** : voir règle 6 de `SKILL.md`.

## Ch. 4 — Commentaires

Martin : « un commentaire compense notre échec à nous exprimer en code ». Avant
d'en écrire un, essayer un meilleur nom ou une fonction extraite.

**Commentaires admis par le livre**, et qui sont la norme du dépôt :
- **explication de l'intention** (pourquoi ce choix, pourquoi pas l'autre) ;
- **avertissement des conséquences** (« purger après le refine ressusciterait
  le document ») ;
- **information** sur une donnée extérieure (format d'Amazon, d'une API) ;
- **clarification** d'une valeur qu'on ne contrôle pas (constante mesurée) ;
- **amplification** d'un détail qui semble anodin et ne l'est pas ;
- **documentation d'API publique**, TODO datés et motivés.

**Commentaires à supprimer** : redondants (paraphrase du code), trompeurs,
obligatoires « pour la forme », journaux de modifications, bruit, marqueurs de
position (`// ===== Helpers =====`), accolades fermantes commentées, code
commenté, information non locale (qui décrit un autre fichier), commentaire
trop long pour ce qu'il explique.

⚠ Adaptation : les longs en-têtes qui racontent une décision mesurée (`Gtin.ts`,
`features.py`) relèvent de « l'explication de l'intention » ; on peut les
resserrer, pas en retirer l'argumentaire.

## Ch. 5 — Mise en forme

Le dépôt n'a pas de formateur configuré (seul le frontend a `next lint`) : ces
règles se vérifient donc à la relecture.

- **Métaphore du journal** : le haut du fichier donne le sujet (commentaire
  d'en-tête, fonction publique), le détail vient en dessous.
- **Ouverture verticale** : une ligne vide entre deux idées.
- **Densité verticale** : pas de ligne vide ni de commentaire au milieu de lignes
  qui vont ensemble.
- **Distance verticale** : variable déclarée au plus près de son usage ;
  fonctions qui s'appellent, proches l'une de l'autre.
- **Largeur** : ~100 caractères, comme le code existant.
- **Règles d'équipe** : suivre le style du fichier et du composant (guillemets,
  point-virgule, nommage des fichiers) plutôt que ses préférences.

## Ch. 6 — Objets et structures de données

- **Abstraction des données** : un objet expose des comportements, pas ses
  champs à modifier. Les objets-valeurs du backend sont immuables, construits
  par `create`.
- **Antisymétrie objets / structures** : un DTO est une structure (des champs,
  aucun comportement) ; un agrégat est un objet (comportements, état caché). Ne
  pas créer d'hybride : un DTO avec des méthodes métier, ou un agrégat dont on
  modifie les champs de l'extérieur.
- **Loi de Déméter** : une fonction ne parle qu'à ses voisins immédiats. Pas de
  « train wreck » `a.getB().getC().doSomething()` sur des **objets**. Naviguer
  dans une **structure** de données (DTO, document Mongo, JSON-LD) n'est pas une
  violation.

## Ch. 7 — Gestion des erreurs

- **Exceptions plutôt que codes retour** — ⚠ sauf aux frontières listées dans
  les exceptions assumées (Server Actions, outils MCP, envoi d'alerte).
- **Commencer par écrire le `try/catch/finally`** quand le code peut échouer :
  il définit ce que l'appelant voit en cas d'échec.
- **Donner du contexte** : l'opération tentée et la valeur en cause, jamais de
  donnée personnelle en clair.
- **Définir les classes d'exception selon les besoins de l'appelant** : c'est le
  rôle des trois familles de `DomainError` (400 / 409 / 404). Une nouvelle erreur
  rejoint une famille, elle n'en invente pas une.
- **Définir le flux normal** (*Special Case*) : un mot-clé inconnu renvoie des
  compteurs à zéro plutôt qu'une erreur que chaque appelant devrait attraper.
- **Ne pas renvoyer ni passer `null`.** ⚠ Adaptation : dans ce dépôt, `null` est
  une valeur métier (« non établi ») et une exigence du contrat JSON. Ce qui
  reste interdit : `null` pour signaler une **erreur**, et `undefined` dans un
  DTO. Quand une collection peut être vide, renvoyer `[]`, jamais `null`.

## Ch. 8 — Frontières

- **Envelopper le code tiers** derrière une interface à soi : Playwright derrière
  les extracteurs, Amazon derrière les parseurs, le backend derrière
  `lib/api.ts` et `mcp/src/backend/client.ts`, le flux carburants derrière
  `fetch_records`. Les types tiers ne se répandent pas dans le code métier.
- **Tests d'apprentissage** : quand on découvre le comportement d'un tiers (une
  page Amazon, une API), le figer dans un test sur une donnée réelle (cf. les
  `*.spec.ts` des parseurs).
- **Code qui n'existe pas encore** : définir l'interface dont on a besoin (un
  port) plutôt qu'attendre l'implémentation.

## Ch. 9 — Tests unitaires

- **Trois lois du TDD** : pas de code de production sans un test qui échoue ;
  pas plus de test qu'il n'en faut pour échouer ; pas plus de code qu'il n'en
  faut pour passer. En relecture : toute nouvelle règle arrive **avec** son test,
  et tout bug corrigé **avec** le test qui le reproduit.
- **Tests propres** : le code de test suit les mêmes règles que le code de
  production. Un langage de test propre au domaine (fixtures `snapshot`,
  `money`, `authAs(user)`) plutôt que des données recopiées.
- **Un concept par test** : un test peut avoir plusieurs `assert`, mais ne
  vérifie qu'un comportement, que son nom décrit.
- **F.I.R.S.T.** :
  - **Fast** — pas de navigateur, pas de réseau, pas de vraie base ;
  - **Independent** — aucun test ne dépend de l'ordre ou de l'état laissé par un
    autre (base `mongomock` neuve à chaque test) ;
  - **Repeatable** — horloge injectée (`now`, `today`), pas de dépendance au
    jour d'exécution ;
  - **Self-validating** — réussite ou échec, pas de sortie à lire à la main ;
  - **Timely** — écrit avant ou avec le code, pas « plus tard ».

## Ch. 10 — Classes

- **Petites**, mesurées en **responsabilités**, pas en lignes. Si le nom de la
  classe a besoin de « et », « ou », « Manager », elle en a trop.
- **Principe de responsabilité unique (SRP)** : une seule raison de changer.
  Exemple : `AmazonIdentityExtractor` change quand le DOM change,
  `AmazonIdentityParser` quand les règles de lecture changent.
- **Cohésion** : chaque méthode utilise la plupart des champs. Un groupe de
  méthodes qui ne partage qu'un sous-ensemble des champs est une classe à
  extraire.
- **Organiser en vue du changement (OCP)** : ajouter une enseigne, un carburant,
  un outil MCP ne devrait pas obliger à modifier le code existant, seulement à
  en ajouter (`IShopScraper`, un fichier d'outils par contexte).
- **Isoler du changement (DIP)** : dépendre d'abstractions (ports,
  `I*Repository`) et non des implémentations Mongo ou Playwright.

## Ch. 11 — Systèmes

- **Séparer la construction de l'usage** : les objets sont assemblés à un seul
  endroit (`main.ts` du scrapper, modules NestJS, fabrique `createMcpServer`) ;
  le code métier ne fait pas `new MongoClient()`.
- **Injection de dépendances** : un use case reçoit ses ports dans son
  constructeur, une fonction du pipeline reçoit `db`.

## Ch. 12 — Conception émergente (les 4 règles de Kent Beck)

Par ordre de priorité, un code bien conçu :
1. passe tous les tests ;
2. ne contient pas de duplication ;
3. exprime l'intention du programmeur ;
4. minimise le nombre de classes et de fonctions.

La 4e règle freine les autres : ne pas extraire une interface ou une classe
« au cas où ». Pas d'abstraction sans second usage, ou sans test qui l'exige.

## Ch. 17 — Odeurs et heuristiques (grille rapide)

| Famille | Odeurs à repérer |
|---|---|
| Commentaires | inappropriés, obsolètes, redondants, mal écrits, code commenté |
| Environnement | build ou tests en plusieurs étapes non documentées |
| Fonctions | trop d'arguments, arguments de sortie, arguments drapeaux, fonction morte |
| Général | plusieurs langages dans un fichier, comportement évident non implémenté, comportement incorrect aux limites, sécurités désactivées, **duplication**, mauvais niveau d'abstraction, classe de base qui dépend de ses dérivées, trop d'information exposée, code mort, séparation verticale, incohérence, fouillis, couplage artificiel, **jalousie de fonctionnalité** (*feature envy*), argument sélecteur, intention obscure, responsabilité mal placée, statique inapproprié, variables explicatives absentes, nom de fonction qui ne dit pas ce qu'elle fait, algorithme non compris, dépendance logique au lieu de physique, `if/else` ou `switch` au lieu de polymorphisme, conventions non suivies, **nombres magiques**, imprécision, structure remplacée par une convention, conditions non encapsulées, conditions négatives, fonction qui fait plusieurs choses, couplages temporels cachés, arbitraire, conditions limites non encapsulées, fonctions qui descendent de plusieurs niveaux d'abstraction, données de configuration enfouies, navigation transitive (Déméter) |
| Noms | non descriptifs, au mauvais niveau d'abstraction, sans vocabulaire standard, ambigus, trop courts pour leur portée, encodages, effets de bord cachés |
| Tests | insuffisants, sans outil de couverture, tests triviaux sautés, test ignoré sans explication, conditions limites non testées, bug voisin non testé, tests lents |

⚠ Adaptation : « plusieurs langages dans un fichier » ne vise pas le mélange
identifiants anglais / commentaires français, qui est la convention du dépôt.

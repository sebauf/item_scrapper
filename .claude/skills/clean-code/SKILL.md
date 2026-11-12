---
name: clean-code
description: Revue et refactoring « clean code » de ce monorepo (scrapper TypeScript, backend NestJS DDD, pipeline Python, frontend Next.js, serveur MCP), avec ses conventions et ses exceptions assumées. À utiliser quand on écrit ou modifie du code du dépôt et qu'on veut le rendre propre, quand on relit un diff ou une PR pour la lisibilité ou la maintenabilité, ou quand l'utilisateur parle de clean code, nettoyage, refactoring, code smells, nommage, fonction trop longue, duplication ou commentaires. Pas pour chercher des bugs (/code-review) ni pour un audit de sécurité (/security-review).
---

# Clean code — item_scrapper

Le code est lu bien plus souvent qu'il n'est écrit. Ici, le prochain lecteur est
souvent une session Claude sans contexte, ou vous dans six mois : **le code et
son commentaire « pourquoi » doivent suffire** à comprendre une décision sans
relire la PR qui l'a introduite.

Ce skill ne remplace pas les conventions du dépôt, il les applique. Quand une
règle générale du livre *Clean Code* contredit un choix documenté ici, **le
choix du dépôt gagne** — voir « Exceptions assumées ».

## Périmètre

- **Dans** : lisibilité, nommage, découpage, place des règles métier, commentaires,
  duplication, propreté des tests, respect des frontières entre couches.
- **Hors** : recherche de bugs (`/code-review`), sécurité (`/security-review`),
  performance non mesurée. Signaler un bug croisé en passant, sans le traiter
  comme un constat de propreté.
- **Jamais dans le même commit** : un refactoring et un changement de
  comportement. Si une assertion de test doit changer, ce n'est plus un
  refactoring.

## Procédure

1. **Délimiter.** Le diff courant (`git diff`, `git diff main...HEAD`) ou les
   fichiers désignés. On ne réécrit pas le reste du fichier : la règle du scout
   s'applique aux lignes touchées et à leur voisinage immédiat.
2. **Charger la référence du module** (table ci-dessous) — elle contient les
   règles d'architecture propres à chaque composant.
3. **Passer le diagnostic** : règles transverses, puis celles du module.
4. **Filtrer** chaque constat par « Exceptions assumées ». Un constat qui y
   figure n'est pas un constat.
5. **Rendre le rapport** (format en bas). N'appliquer les corrections que si
   l'utilisateur le demande, ou si la tâche en cours consiste à écrire ce code.
6. **Après modification**, relancer les tests et le typecheck du module touché,
   et chercher les commentaires, `CLAUDE.md` et `README.md` qui décrivent le
   comportement modifié.

| Répertoire | Référence | Vérification |
|---|---|---|
| `backend/` | [references/backend.md](references/backend.md) | `npm test` · `npm run build` |
| `scrapper/` | [references/scrapper.md](references/scrapper.md) | `npm test` · `npm run typecheck` |
| `pipeline/` | [references/pipeline.md](references/pipeline.md) | `python -m pytest` |
| `frontend/` | [references/frontend.md](references/frontend.md) | `npm test` · `npm run typecheck` |
| `mcp/` | [references/mcp.md](references/mcp.md) | `npm test` · `npm run build` |
| `e2e/`, `airflow/`, `k8s/` | règles transverses seulement | voir `CLAUDE.md` |

## Règles transverses

### 1. Noms

- Le nom dit l'intention ; s'il faut un commentaire pour l'expliquer, c'est le
  nom qui est faux.
- **Unité dans le nom** de tout nombre : `PURGE_AFTER_DAYS`, `STALE_AFTER_HOURS`,
  `radiusKm`, `MIN_BAND_PCT`. Un `timeout = 30` sans unité est un constat.
- **Un mot par concept, celui du domaine.** Le dépôt a déjà son vocabulaire :
  relevé (`items_raw`), historique (`price_history`), offre, conditionnement
  (`packSize`, `quantity`, `doses`), rupture (*shortage*), réapprovisionnement
  (*restock*), station favorite. N'introduire ni synonyme ni second nom.
- Booléens en prédicat : `isDeal`, `isStale`, `isFavorite`, `available`.
- **Identifiants en anglais, commentaires, messages et noms de tests en
  français** — c'est l'usage de tout le dépôt.

### 2. Fonctions

- **Règle métier = fonction pure** (entrées → sortie, ni I/O ni horloge
  implicite). Les effets de bord vivent à la périphérie : handlers, repositories,
  controllers, `main`. C'est ce qui permet aux suites de tests de tourner sans
  navigateur, sans réseau et sans base.
- **Pas de seuil de lignes.** Les vrais signaux : la fonction mélange deux
  niveaux d'abstraction (règle métier + sélecteur CSS, calcul + écriture Mongo) ;
  elle a besoin de commentaires de section internes ; on ne peut pas tester une
  de ses règles sans monter toute l'infrastructure.
- Clauses de garde en tête, un seul chemin nominal.
- Pas de booléen-drapeau qui change le comportement : deux fonctions, ou une
  union de chaînes (`sort: 'distance' | 'price'`).
- Au-delà de trois paramètres, un objet nommé.

### 3. Constantes et seuils

- Tout seuil métier est une constante nommée, **avec un propriétaire unique** :
  `DEAL_SCORE_THRESHOLD` vit dans `catalog/domain/deal-policy.ts` et nulle part
  ailleurs. Une copie du nombre dans un deuxième fichier est un constat.
- Le commentaire de la constante dit **d'où vient la valeur** : une mesure
  (« mesuré le 06/11/2026 : … »), une contrainte externe (plafond d'API, budget
  de crawl), un compromis. Un seuil sans justification est un seuil qu'on n'ose
  plus modifier.
- Quand deux réglages « voyagent ensemble » (budget de crawl, plafond par
  mot-clé, règle de fraîcheur), chaque définition renvoie aux autres.

### 4. Commentaires

- **Le commentaire « pourquoi » est la norme du dépôt**, pas un aveu d'échec :
  décision mesurée, contrainte d'Amazon, de Next.js ou de Google OAuth, piège
  évité, alternative écartée et raison. On le garde, on le tient à jour.
- On supprime : le commentaire qui paraphrase le code, le code commenté, le
  journal de modifications (git s'en charge).
- **Un commentaire devenu faux est pire qu'aucun commentaire.** Tout changement
  de comportement implique de relire les commentaires qui le décrivent — y
  compris dans `CLAUDE.md` et les `README.md`.

### 5. Erreurs

- Échouer tôt, à la frontière : objet-valeur qui refuse une entrée invalide,
  configuration validée au démarrage (`AppConfig`, `McpConfig`).
- Un message d'erreur dit ce qui ne va pas et avec quelle valeur — **jamais une
  donnée personnelle en clair** (le pipeline masque les numéros avec
  `mask_phone`).
- Pas de `catch` qui avale tout : capture ciblée, ou journalisation + raison
  écrite de continuer.
- Certaines frontières **renvoient** l'erreur au lieu de la lever : voir les
  exceptions assumées.

### 6. Duplication

- **Dupliquer une règle métier est un bug différé** : deux propriétaires finissent
  par diverger. Dupliquer trois lignes de plomberie est souvent acceptable.
- Avant d'extraire une abstraction commune, vérifier que les deux usages
  changeront pour les mêmes raisons. Sinon, la duplication est le moindre mal.

### 7. Tests

- Chaque règle extraite en fonction pure a son test unitaire.
- **Le nom du test décrit le comportement**, en français :
  `it('refuse au-delà de MAX_LENGTH, après trim')`,
  `def test_produit_relevé_hier_reste_eligible`.
- **Ne pas simuler ce qu'on veut vérifier.** Les tests du pipeline exécutent les
  vraies agrégations sur `mongomock` ; la suite e2e juge l'état réel de la base.
  Remplacer une agrégation par un mock qui renvoie le résultat attendu ne teste
  plus rien.
- Refactoring : suite verte avant, verte après, **assertions inchangées**.

### 8. Code mort et code généré

- Supprimer le code mort, les exports et paramètres inutilisés.
- **Ne jamais éditer à la main** les fichiers générés — corriger la source et
  régénérer :
  - `frontend/src/lib/api-types.ts`, `mcp/src/backend/api-types.ts` →
    `npm run gen:api` (backend démarré) ;
  - `frontend/public/icons/*` → `frontend/scripts/generate-icons.mjs`.

## Exceptions assumées — ne pas « corriger »

Ces choix ressemblent à des écarts au *Clean Code* classique. Ils sont voulus et
documentés ; les signaler comme défauts serait une régression.

| Ce qu'on voit | Où | Pourquoi c'est voulu |
|---|---|---|
| `null` renvoyé ou stocké comme valeur | DTO du backend, champs d'identité (`ean`, `packSize`…), `price: null`, scores | `null` porte un sens métier : « non établi », « pas de bloc prix lu ». Les DTO utilisent `null`, **jamais** `undefined`, qui disparaîtrait du JSON. |
| Server Action qui renvoie `{ error }` au lieu de lever | `frontend/src/app/actions.ts` | En production, Next.js masque le message d'une erreur levée : l'utilisateur ne verrait jamais « quota atteint ». |
| Outil MCP qui renvoie `isError: true` au lieu d'une exception | `mcp/src/tools/` | L'agent lit l'erreur et peut corriger son appel ; une exception de protocole l'arrêterait net. |
| Échec d'envoi d'alerte journalisé, import poursuivi | `pipeline/src/fuel/restock_alerts.py` | Une alerte ratée ne doit pas bloquer les prix ; l'état reste « en rupture » et l'alerte est retentée à l'import suivant. |
| Long commentaire d'en-tête qui raconte une décision | partout (`Gtin.ts`, `features.py`…) | C'est la documentation de conception du dépôt (mesures, alternatives écartées). Raccourcir est permis, supprimer l'argumentaire ne l'est pas. |
| `internal-token.ts` copié dans trois services | `backend`, `frontend`, `mcp` | Pas de paquet partagé entre services ; toute modification se reporte dans les trois copies. |
| Lecture qui contourne l'agrégat et va droit à Mongo | `backend/src/modules/*/infrastructure/*.read-model.ts` | CQRS-lite : ces données sont écrites par le scrapper et le pipeline, il n'y a aucun invariant à protéger côté lecture. |
| Agrégation Mongo de plusieurs dizaines de lignes | read models, `build_price_history`, purge | Une agrégation est déclarative et se lit d'un bloc ; la découper en fragments peut nuire à la lecture. Extraire les étapes **réutilisées** (comme `aggregation-stages.ts`), pas les autres. |

## Diagnostic rapide

| Question | Si non |
|---|---|
| Comprend-on chaque fonction sans lire son corps ? | Renommer. |
| Chaque règle métier est-elle testable sans navigateur, réseau ni base ? | L'extraire en fonction pure. |
| Chaque nombre métier est-il une constante nommée, avec unité et justification ? | Nommer, justifier, un seul propriétaire. |
| Les imports respectent-ils les frontières du module (cf. référence) ? | Déplacer le code, pas la règle. |
| Les commentaires disent-ils encore la vérité après ce diff ? | Les mettre à jour, `CLAUDE.md` compris. |
| Un fichier généré a-t-il été modifié à la main ? | Annuler, régénérer. |
| Les tests portent-ils des noms de comportement ? | Renommer. |

## Format du rapport

Constats regroupés par gravité, chacun en une ou deux lignes :

- **À corriger** — viole une règle du dépôt (frontière de couche, fichier généré
  édité, seuil dupliqué, commentaire devenu faux, donnée personnelle en clair).
- **À améliorer** — lisibilité : nom, découpage, duplication, test mal nommé.
- **À discuter** — question de goût ou compromis ; donner les deux options.

Chaque constat : `chemin/fichier.ts:ligne` — règle — pourquoi c'est un problème
ici — proposition concrète (extrait de code si utile).

Terminer par :
- les **exceptions assumées rencontrées** et volontairement non signalées (une
  ligne chacune), pour que le lecteur sache qu'elles ont été vues ;
- les **commandes de vérification** lancées et leur résultat, ou « non lancées »
  si rien n'a été modifié.

---

*Organisation inspirée du skill `clean-code` de wondelai/skills (licence MIT) ;
règles réécrites pour les conventions de ce dépôt.*

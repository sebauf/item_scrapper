# Backend — NestJS 11, DDD + CQRS-lite

Source de vérité : `backend/README.md` (organisation, règle de dépendance, API).
Ce fichier n'en garde que ce qui sert à juger la propreté d'un diff.

## Frontières (à corriger si violées)

`domain` → rien · `application` → `domain` · `infrastructure` et `interface` → tout.

- Aucun fichier sous `domain/` n'importe `@nestjs/*` ni `mongodb`. Un décorateur
  `@Injectable()` dans le domaine est un constat.
- `application/` n'importe pas `infrastructure/` : elle dépend de **ports**
  (`domain/*.repository.ts`, `application/ports/*.read-model.ts`), implémentés
  dans `infrastructure/`.
- Entre modules, à sens unique et sans cycle : le `domain/` et l'`application/`
  d'un module peuvent utiliser le `domain/` et l'`application/` (objets-valeurs,
  erreurs, ports, commandes) d'un autre — favorite → catalog et
  product-tracking, profile → fuel, le tableau de bord de catalog → les ports de
  lecture de keyword et product-tracking. Jamais son `infrastructure/`. Une
  `interface/` peut réutiliser le DTO de réponse d'un autre module quand elle
  renvoie la même chose (favoris → `ProductDetailResponse`). Ce que plusieurs
  modules partagent va dans `src/shared/` (`UserId`, `ProductId`).
- Le domaine ne connaît pas HTTP : il lève une `DomainError` qui décrit le
  problème, jamais un code de statut. La traduction en 400 / 404 / 409 se fait
  une seule fois, dans `DomainExceptionFilter`.

## Où placer quoi

| Besoin | Emplacement | Exemple |
|---|---|---|
| Valider une valeur une fois pour toutes | objet-valeur (`domain/`) : constructeur privé, `static create(raw: unknown)`, immuable, `equals` | `KeywordName`, `ProductId`, `PhoneNumber`, `UserId` |
| Protéger une transition d'état | méthode de l'agrégat, qui lève si la transition est illégale | `Keyword.retrack()` |
| Une politique métier chiffrée | classe ou module de politique, **seul propriétaire** du seuil | `DealPolicy` / `DEAL_SCORE_THRESHOLD`, `freshness-policy.ts`, `KeywordQuota` |
| Écrire | `application/commands/*.command.ts` : **orchestre, ne contient aucune règle**, ne renvoie rien | `TrackKeywordCommand` |
| Lire pour un écran | `application/queries/*.query.ts` + port `*.read-model.ts`, structure plate | `SearchProductsQuery` |
| Agrégation Mongo, mapping document → DTO | `infrastructure/` (`mongo-*.read-model.ts`, `*.mapper.ts`) | `product.mapper.ts` |
| Valider la requête HTTP, décrire le contrat | `interface/` (controller + `dto/`) | `catalog.controller.ts` |
| Doubles de test | `<module>/testing/` (exclu du build) | `catalog/testing/fakes.ts` |

Signaux de mauvais placement :
- un `if` métier dans un controller ou une commande → le descendre dans le
  domaine ;
- une `string` brute qui circule là où un objet-valeur existe (un e-mail au lieu
  d'un `UserId`) ;
- un seuil recopié dans une query alors qu'une politique le possède déjà.

## Erreurs

- Toute erreur métier hérite d'une des trois familles de
  `shared/domain/domain-error.ts` : `InvalidInputError` (400), `ConflictError`
  (409), `ResourceNotFoundError` (404). Une erreur qui n'en hérite pas finit en
  500 — c'est voulu pour un bug, pas pour un refus prévu.
- Chaque erreur porte un `code` stable en anglais majuscule
  (`KEYWORD_QUOTA_EXCEEDED`) et un message en français pour l'humain.
- Les erreurs d'un module vivent dans `domain/<module>.errors.ts`.

## Utilisateur courant

- Lu dans le controller avec `@CurrentUser()`, puis passé **explicitement** en
  `UserId` aux commandes et queries. Pas de provider à portée requête, pas de
  lecture de `request` hors de `interface/`.
- Une route ajoutée est protégée par défaut (garde globale) ; `@Public()` est
  réservé aux sondes.

## DTO de réponse

- Champs absents = `null`, **jamais** `undefined` (sinon ils disparaissent du
  JSON et le frontend teste `!== null` à tort).
- Les valeurs calculées (`isDeal`, `id` encodé) sont produites ici : le frontend
  n'a aucune règle métier.
- Un DTO modifié implique `npm run gen:api` dans `frontend/` et `mcp/`.

## Nommage des fichiers

kebab-case, suffixe = rôle : `keyword-name.ts`, `keyword.errors.ts`,
`keyword.repository.ts`, `track-keyword.command.ts`,
`search-products.query.ts`, `mongo-product.read-model.ts`, `product.mapper.ts`,
test à côté : `*.spec.ts`.

## Tests (Jest)

- Domaine et use cases testés sans base ni HTTP, avec les doubles de `testing/`.
- Les tests de controller passent par la vraie garde (`authAs(user)` dans
  `src/testing/http.ts`) : ne pas la court-circuiter pour « simplifier ».
- Noms en français, décrivant le comportement :
  `it('refuse au-delà de MAX_LENGTH, après trim')`.

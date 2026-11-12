# Frontend — Next.js 15, React 19, Tailwind CSS v4, Auth.js v5

## Principe directeur : le frontend ne possède aucune règle métier

Tout ce qui est calculé l'est par le backend : `isDeal`, l'`id` opaque du
produit, la fraîcheur des prix (`isStale`), les niveaux de risque des
prévisions, les messages d'erreur métier. Le frontend **affiche** et **met en
forme**.

**Constat « à corriger »** : un seuil, un calcul de score, une règle de
validation métier ou un message de refus réécrit côté frontend. La règle aurait
deux propriétaires, et deux formulations selon le point d'entrée (frontend ou
MCP).

## Frontières (à corriger si violées)

- **Un seul accès aux données** : `src/lib/api.ts`. Aucun `fetch` vers le
  backend ailleurs, aucun driver Mongo.
- `api.ts` et `internal-token.ts` importent `'server-only'` : ne jamais retirer
  ce verrou, ne jamais les importer depuis un fichier `'use client'`.
- Les appels partent du serveur (Server Components, Server Actions). Un
  composant client qui a besoin de données les reçoit en props, ou passe par
  une Server Action.
- `src/lib/api-types.ts` est **généré** (`npm run gen:api`) : le modifier à la
  main est toujours un constat.

## Où placer quoi

| Besoin | Emplacement |
|---|---|
| Page, chargement des données | `src/app/**/page.tsx` (Server Component) |
| Mutation déclenchée par l'utilisateur | `src/app/actions.ts` (Server Action) |
| Interactivité (état, effets, carte) | `src/components/*.tsx` avec `'use client'`, le plus bas possible dans l'arbre |
| Analyse indulgente de l'URL du navigateur | `src/lib/search-params.ts` |
| Mise en forme (prix, dates) — toute date passe par `formatDate` / `formatDateTime` / `formatDayMonth`, à l'heure de Paris (`DISPLAY_TIME_ZONE`), jamais par un `toLocaleDateString` sans fuseau | `src/lib/format.ts` |
| Données du graphique de prix (points, devise, seuil de traçabilité) | `src/lib/price-history.ts` |
| Règles d'affichage carburants (URL, Google Maps, marque par défaut) | `src/lib/fuel.ts` |
| Règles d'authentification pures | `src/lib/auth-policy.ts` |

Signaux de mauvais placement :
- logique de mise en forme dupliquée dans plusieurs composants → `lib/format.ts` ;
- parsing de `searchParams` dans une page → `lib/search-params.ts` ;
- `'use client'` sur une page entière pour un seul bouton → extraire le bouton.

## Règles propres au frontend

- Champs de l'API absents = `null` : tester `!== null` (ou `!= null`), jamais
  `!== undefined`.
- Composants : un fichier par composant, nommé comme lui (PascalCase), props
  typées depuis les types de `api.ts` plutôt que redéclarées.
- Dates : affichées en `Europe/Paris` explicitement (le serveur rend en UTC).
- Accessibilité : un bouton icône (étoile favori) a un libellé accessible ; les
  tests Testing Library le trouvent par son rôle et son nom.
- Le matcher du middleware exclut des **préfixes** : ne jamais y ajouter un
  préfixe qui pourrait couvrir une page.

## Exceptions assumées propres au frontend

| Ce qu'on voit | Pourquoi ne pas le « corriger » |
|---|---|
| Server Actions qui renvoient `{ error }` / `{ success }` (`FormState`) au lieu de lever | En production, Next.js masque le message d'une erreur levée dans une action : l'utilisateur ne verrait jamais « quota atteint ». Les erreurs 4xx du backend sont relayées telles quelles, les autres remplacées par un message générique et journalisées — une seule fois, dans `submitForm`. Les aides de `actions.ts` restent non exportées : dans un fichier `'use server'`, toute fonction exportée est une Server Action. |
| Mise à jour optimiste avec retour arrière (`FavoriteStationButton`) | Voulue : réactivité de l'étoile ; le retour arrière sur échec est la partie à ne pas perdre. |
| `internal-token.ts` dupliqué depuis le backend | Pas de paquet partagé entre services ; toute modification se reporte dans les trois copies. |

## Tests (Vitest + Testing Library, jsdom)

- Un `*.test.tsx` à côté de chaque composant, un `*.test.ts` à côté de chaque
  module de `lib/`.
- Interroger le DOM comme un utilisateur (rôle, libellé, texte), pas par classe
  CSS ni structure interne.
- Réutiliser `src/testing/` (`fixtures.ts`, `auth-mock.ts`,
  `navigation-mock.ts`) plutôt que redéfinir des données de test.
- Noms en français, décrivant ce que voit l'utilisateur :
  `it('affiche un zéro plutôt que rien')`.

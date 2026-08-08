# Backend — API price tracker

Service NestJS (moteur HTTP Fastify) : **seul composant applicatif autorisé à
lire MongoDB pour l'affichage**. Le frontend l'appelle en HTTP côté serveur et
n'embarque plus de driver Mongo.

## Démarrage

```bash
cd backend
npm install
cp .env.example .env        # ajuster MONGODB_URI si besoin
npm run start:dev           # http://localhost:3001, docs sur /docs
```

| Script | Effet |
|---|---|
| `npm run start:dev` | serveur en watch |
| `npm run build` | compile vers `dist/` |
| `npm run start:prod` | exécute `dist/main.js` |
| `npm test` | tests unitaires (Jest) |

## Organisation

```
src/
├── config/            AppConfig — variables d'env validées au démarrage
├── shared/
│   ├── domain/        DomainError et ses 3 familles (400 / 409 / 404)
│   ├── infrastructure/mongo/   connexion partagée + index requis
│   └── interface/http/         traduction erreur métier → réponse HTTP
├── health/            sondes /health/live et /health/ready
└── modules/
    ├── keyword/       contexte « mots-clés suivis » — écriture + lecture
    │   ├── domain/            Keyword (agrégat), KeywordName (objet-valeur),
    │   │                      KeywordRepository (port), erreurs métier
    │   ├── application/
    │   │   ├── commands/      écriture — modifient l'état, ne renvoient rien
    │   │   ├── queries/       lecture — renvoient des données d'affichage
    │   │   └── ports/         contrats attendus de l'infrastructure
    │   ├── infrastructure/    implémentations MongoDB des ports
    │   ├── interface/         controller + DTO d'entrée/sortie
    │   └── testing/           doubles de test (exclus du build)
    └── catalog/       contexte « produits et prix » — lecture seule
        ├── domain/            ProductId, ProductQuery (objets-valeurs),
        │                      DealPolicy (le seuil de bonne affaire)
        ├── application/       queries + ports de read model
        ├── infrastructure/    agrégations Mongo + mapper document → DTO
        └── interface/         controllers + DTO de réponse
```

### Règle de dépendance

`domain` → rien · `application` → `domain` · `infrastructure` et `interface` → tout.

Concrètement : aucun fichier de `domain/` n'importe `@nestjs/*` ni `mongodb`. On
peut tester tout le métier sans lancer ni serveur ni base.

### CQRS-lite

Deux chemins distincts, une seule base :

- **Écriture** (`commands/`) — passe par l'agrégat `Keyword`, qui refuse les
  transitions illégales. C'est là que vivent les règles.
- **Lecture** (`queries/` + `ports/*.read-model.ts`) — requêtes taillées pour un
  écran, renvoyant des structures plates. Pas d'agrégat : ces données sont
  produites par le scrapper et le pipeline, le backend ne les modifie jamais,
  donc il n'y a aucun invariant à protéger.

## API

Préfixe `/api/v1` (sauf les sondes, volontairement hors versionnement).

| Méthode | Route | Réponses |
|---|---|---|
| `GET` | `/api/v1/dashboard` | 200 — compteurs globaux + meilleures affaires par mot-clé |
| `GET` | `/api/v1/keywords` | 200 — mots-clés suivis + nb de produits + dernier scrape |
| `POST` | `/api/v1/keywords` | 201 · 400 nom invalide · 409 déjà suivi |
| `DELETE` | `/api/v1/keywords/{keyword}` | 204 (idempotent) · 404 inconnu |
| `GET` | `/api/v1/keywords/{keyword}/products` | 200 · 400 filtre invalide |
| `GET` | `/api/v1/products/{id}` | 200 · 400 id mal formé · 404 inconnu |
| `GET` | `/health/live` | 200 — le processus répond |
| `GET` | `/health/ready` | 200 · 503 si MongoDB est injoignable |

Paramètres de `/keywords/{keyword}/products` : `q` (titre), `deals` (1/0),
`min`, `max` (prix), `sort` (`deals` · `price_asc` · `price_desc` · `discount`),
`page` (24 produits par page). Un mot-clé inconnu renvoie 200 avec des
compteurs à zéro — c'est au client de décider s'il affiche une 404.

### Deux différences volontaires avec l'ancien code du frontend

**`null` plutôt qu'absent.** `dealScore`, `predictedPrice` et `trendDirection`
valaient `undefined` et disparaissaient du JSON ; ils valent maintenant `null`.
Un test `!== undefined` côté frontend doit donc devenir `!= null`.

**`isDeal` est calculé côté serveur.** Le frontend recevait le score brut et
appliquait lui-même le seuil. Il reçoit désormais le booléen : la politique
« bonne affaire » n'a plus qu'un seul propriétaire (`catalog/domain/deal-policy.ts`).

De même, chaque produit porte un champ `id` déjà encodé : le frontend n'a plus à
encoder d'URL pour construire ses liens.

Contrat OpenAPI : `/openapi.json` (UI sur `/docs`). C'est la source depuis
laquelle le frontend générera ses types.

## Propriété des collections MongoDB

La base est partagée entre les services ; l'écriture ne l'est pas.

| Collection | Écrite par | Lue par le backend |
|---|---|---|
| `keywords` | **backend** (et encore le scrapper, cf. dette ci-dessous) | oui |
| `items_raw` | scrapper | oui |
| `price_history`, `deal_scores` | pipeline | oui |

**Dette assumée** : le scrapper lit encore `keywords` directement au lieu de
passer par `GET /api/v1/keywords`, et y seede ses mots-clés par défaut. La
bascule est repoussée ; son port `IKeywordRepository` existe déjà côté scrapper,
il n'y aura qu'une implémentation HTTP à y brancher.

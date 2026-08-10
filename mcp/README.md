# MCP — serveur d'outils pour agent

Expose l'API price tracker à un agent LLM (Hermes) via le protocole
[MCP](https://modelcontextprotocol.io). L'agent tourne hors du cluster : le
serveur est donc joignable en HTTP, derrière un jeton porteur.

Il ne parle **jamais** à MongoDB. Il appelle le backend, exactement comme le
frontend — la règle « le backend est le seul lecteur applicatif de la base »
reste vraie.

```
Hermes ──HTTP/MCP──> mcp ──HTTP/REST──> backend ──> MongoDB
```

## Démarrage

```bash
cd mcp
npm install
cp .env.example .env
# renseigner MCP_AUTH_TOKEN — le serveur refuse de démarrer sans
openssl rand -hex 32

npm run start:dev          # http://localhost:3010/mcp (backend requis sur :3001)
npm test                   # tests unitaires (node:test) — ni backend ni base
npm run build && npm run start:prod
npm run gen:api            # régénère src/backend/api-types.ts depuis /openapi.json
```

`src/backend/api-types.ts` est **généré et commité**, comme côté frontend :
relancer `gen:api` (backend démarré) après tout changement de DTO, sinon les
types dérivent du contrat.

## Ce que voit l'agent

Douze outils. Les noms, descriptions et schémas d'entrée sont ce que le modèle
lit pour décider quoi appeler — ils sont donc rédigés pour lui, pas pour un
développeur.

| Outil | Effet | Annotation |
|---|---|---|
| `get_dashboard` | compteurs globaux + meilleures affaires par mot-clé | lecture seule |
| `list_keywords` | mots-clés suivis, nb de produits, dernier scrape | lecture seule |
| `search_products` | produits d'un mot-clé, filtrés/triés/paginés | lecture seule |
| `get_product` | fiche produit + historique de prix | lecture seule |
| `track_keyword` | ajoute un mot-clé au suivi | écriture |
| `untrack_keyword` | retire un mot-clé du suivi | écriture, destructif |
| `list_tracked_urls` | URLs produit suivies individuellement, dernier prix | lecture seule |
| `track_product_url` | suit une fiche produit précise, hors mot-clé | écriture |
| `untrack_product_url` | retire une URL du suivi individuel | écriture, destructif |
| `list_favorites` | produits favoris + aperçu de leur évolution de prix | lecture seule |
| `add_favorite` | met un produit en favori (garantit aussi son suivi) | écriture, idempotent |
| `remove_favorite` | retire un favori (le suivi de prix continue) | écriture, idempotent |

Les annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`) ne sont
pas décoratives : un client MCP s'en sert pour décider s'il demande une
confirmation. Un outil d'écriture annoncé en lecture seule serait un piège.
`add_favorite`/`remove_favorite` sont annoncés `destructiveHint: false` — à la
différence d'un `untrack_*`, retirer un favori n'arrête aucune collecte, ce
n'est qu'un signet.

À l'initialisation, le serveur envoie aussi des **instructions** (`server.ts`) :
d'où viennent les données, à quelle fréquence elles changent, ce que « bonne
affaire » veut dire ici. C'est le contexte que le modèle ne peut pas deviner
depuis la seule signature des outils.

### Réponses en texte, pas en JSON

Les outils renvoient du texte compact plutôt que le JSON du backend. Celui-ci
est taillé pour une interface graphique — tableaux d'images, champs répétés — et
coûterait des jetons pour rien. Le formatage (`format.ts`) garde
systématiquement l'`id` opaque du produit : c'est la seule clé qui permet
ensuite d'appeler `get_product`.

Une erreur d'appel revient comme un résultat d'outil en échec (`isError: true`),
pas comme une exception de protocole : l'agent peut corriger son appel (mot-clé
inconnu, filtre invalide) au lieu de voir la conversation s'interrompre.

## Organisation

```
src/
├── main.ts            démarrage, arrêt propre sur SIGTERM
├── config.ts          McpConfig — variables d'env validées au démarrage
├── http.ts            façade HTTP : /mcp, /health/live, /health/ready, auth bearer
├── server.ts          fabrique du serveur MCP + instructions envoyées au modèle
├── format.ts          DTO du backend → texte destiné au modèle
├── backend/
│   ├── client.ts      client HTTP typé de l'API (timeout, erreurs)
│   └── api-types.ts   généré depuis /openapi.json — ne pas éditer
├── tools/             définition des outils, par contexte métier
└── testing/           fixtures, exclues du build
```

## Transport

Transport « Streamable HTTP », en mode **stateless** : un serveur MCP et un
transport neufs à chaque requête, fermés dès la réponse envoyée. Aucun état ne
survit entre deux appels, donc rien à répliquer si on passe à plusieurs pods, et
deux clients ne peuvent pas se marcher dessus sur les identifiants JSON-RPC.

## Sécurité

Le serveur est le seul composant applicatif volontairement exposé hors du
cluster, et il porte des outils d'écriture. Sa protection est le jeton :

- `Authorization: Bearer <MCP_AUTH_TOKEN>` exigé sur `/mcp` ;
- comparaison à temps constant (un `===` fuiterait le préfixe correct) ;
- démarrage refusé si ni `MCP_AUTH_TOKEN` ni `MCP_ALLOW_ANONYMOUS=true` : ouvrir
  le serveur doit être un choix, jamais un oubli ;
- `MCP_ALLOWED_HOSTS` active la protection anti-DNS rebinding. Vide par défaut,
  parce qu'on ne code pas de nom d'hôte en dur ; à renseigner une fois le nom
  réel connu.

Le jeton est **le seul** rempart : ne pas déployer l'Ingress sans avoir
renseigné `MCP_AUTH_TOKEN` dans `k8s/base/secrets.env`.

## Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `BACKEND_URL` | `http://localhost:3001` | racine de l'API, sans `/api/v1` |
| `PORT` | `3010` | port d'écoute |
| `MCP_AUTH_TOKEN` | — | jeton porteur, 16 caractères minimum |
| `MCP_ALLOW_ANONYMOUS` | `false` | ouvre le serveur sans jeton (dev local) |
| `BACKEND_TIMEOUT_MS` | `10000` | abandon d'un appel backend |
| `MCP_ALLOWED_HOSTS` | vide | hôtes acceptés (`Host`), séparés par des virgules |

## Brancher l'agent

La plupart des clients MCP acceptent une configuration de cette forme :

```json
{
  "mcpServers": {
    "price-tracker": {
      "type": "http",
      "url": "https://<hôte-du-cluster>/mcp",
      "headers": { "Authorization": "Bearer <MCP_AUTH_TOKEN>" }
    }
  }
}
```

Vérification rapide, sans client :

```bash
curl -s -X POST http://localhost:3010/mcp \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Déploiement

`k8s/base/mcp-{deployment,service,ingress}.yaml`. L'Ingress est sans host
(catch-all), sur le préfixe `/mcp` : Traefik le préfère au `/` du frontend,
qui reste plus général. Image publiée par `.github/workflows/mcp.yml` sur
`ghcr.io/<repo>-mcp`.

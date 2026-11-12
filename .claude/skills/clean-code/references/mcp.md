# Serveur MCP — `@modelcontextprotocol/sdk`, Streamable HTTP, sans état

Source de vérité : `mcp/README.md` (catalogue des outils, modèle de sécurité).

## Organisation

```
src/config.ts        McpConfig — variables d'environnement validées au démarrage
src/http.ts          façade HTTP : /mcp, /health/live, /health/ready
src/server.ts        fabrique du serveur MCP + instructions envoyées au modèle
src/format*.ts       DTO du backend → texte compact pour le modèle
src/backend/         client HTTP typé + api-types.ts (généré)
src/tools/           définitions d'outils, un fichier par contexte métier
```

## Frontières (à corriger si violées)

- **Aucun accès direct à la base** : tout passe par `src/backend/client.ts`,
  comme le frontend.
- **Aucune règle métier** : le MCP traduit, il ne décide pas. Un seuil ou un
  calcul recopié du backend est un constat.
- Un outil **ne fabrique pas son texte lui-même** : il appelle le client, puis
  une fonction de `format.ts` / `format-fuel.ts`. La mise en forme se teste
  sans serveur ni backend.
- `src/backend/api-types.ts` est **généré** (`npm run gen:api`).

## Règles propres au MCP

- **Le lecteur est un modèle de langage.** Les outils renvoient du texte compact,
  jamais le JSON brut de l'API (taillé pour une interface graphique, il coûte des
  tokens pour rien).
- **Toujours conserver l'`id` opaque du produit** dans le texte : c'est la seule
  clé qui permet à l'agent d'appeler `get_product` ensuite.
- Chaque outil passe par `runTool(...)` (`tools/tool-result.ts`) : une erreur
  revient comme résultat `isError: true`, pas comme exception de protocole.
- **Descriptions d'outils = documentation pour le modèle** : elles disent ce que
  fait l'outil, ce qu'il ne fait pas (« aucun produit n'apparaît
  immédiatement ») et les unités. Un changement de comportement sans mise à
  jour de la description est « à corriger ».
- **Annotations honnêtes** : `readOnlyHint`, `destructiveHint`, `idempotentHint`
  reflètent l'effet réel. Les clients s'en servent pour demander confirmation ;
  une annotation fausse retire ce garde-fou.
- Schémas d'entrée `zod` avec bornes explicites (`min`, `max`, valeurs par
  défaut) alignées sur celles du backend.
- Dates en heure de Paris, prévisions formulées « avant <fin de l'horizon> »
  (`format-fuel.ts`) — jamais une date de rupture inventée.

## Exceptions assumées propres au MCP

| Ce qu'on voit | Pourquoi ne pas le « corriger » |
|---|---|
| `try/catch` générique dans `runTool` qui renvoie au lieu de relancer | C'est la frontière : l'agent doit lire l'erreur pour corriger son appel. |
| Un `McpServer` et un transport neufs à chaque requête | Transport sans état, voulu ; ce n'est pas un gaspillage à mettre en cache. |
| `internal-token.ts` copié du backend | Pas de paquet partagé ; reporter toute modification dans les trois copies. |

## Tests (`node:test`, `npm test`)

- `format*.spec.ts` : la mise en forme, à partir de DTO de test.
- `server.spec.ts` : les outils de bout en bout, via un vrai client MCP sur
  `InMemoryTransport` et des DTO de `src/testing/fixtures.ts`, y compris les cas
  `isError: true`.
- Noms en français, décrivant le comportement.

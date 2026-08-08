import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { BackendClient } from '../backend/client.js';
import { formatKeywordSummaries } from '../format.js';
import { runTool, text } from './tool-result.js';

/**
 * Outils du contexte Keyword — le seul endroit où l'agent écrit.
 *
 * Les annotations le disent explicitement : `readOnlyHint: false` et, pour le
 * retrait, `destructiveHint: true`. Un client MCP s'en sert pour demander une
 * confirmation avant d'exécuter l'appel.
 */
export function registerKeywordTools(server: McpServer, backend: BackendClient): void {
  server.registerTool(
    'list_keywords',
    {
      title: 'Mots-clés suivis',
      description:
        'Liste les mots-clés suivis par le scrapper, avec le nombre de produits remontés et ' +
        'la date du dernier passage. Un mot-clé absent de cette liste n\'est pas suivi.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => runTool(async () => text(formatKeywordSummaries(await backend.listKeywords()))),
  );

  server.registerTool(
    'track_keyword',
    {
      title: 'Suivre un mot-clé',
      description:
        "Ajoute un mot-clé au suivi. Le scrapper le prendra en compte à sa prochaine " +
        "exécution (DAG quotidien) : aucun produit n'apparaît immédiatement. Réactive un " +
        'mot-clé précédemment retiré.',
      inputSchema: {
        keyword: z
          .string()
          .min(1)
          .max(100)
          .describe('Termes de recherche, tels qu\'on les taperait sur la boutique'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    ({ keyword }) =>
      runTool(async () => {
        await backend.trackKeyword(keyword);
        return text(
          `Mot-clé « ${keyword} » ajouté au suivi. Les produits apparaîtront après le prochain scrape.`,
        );
      }),
  );

  server.registerTool(
    'untrack_keyword',
    {
      title: 'Retirer un mot-clé',
      description:
        "Retire un mot-clé du suivi : le scrapper cesse de le relever. Les produits déjà " +
        'collectés et leur historique restent en base.',
      inputSchema: {
        keyword: z.string().min(1).describe('Mot-clé exactement tel que renvoyé par list_keywords'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    ({ keyword }) =>
      runTool(async () => {
        await backend.untrackKeyword(keyword);
        return text(`Mot-clé « ${keyword} » retiré du suivi.`);
      }),
  );
}

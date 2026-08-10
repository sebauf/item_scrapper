import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { BackendClient } from '../backend/client.js';
import { formatTrackedUrlSummaries } from '../format.js';
import { runTool, text } from './tool-result.js';

/**
 * Outils du contexte product-tracking — miroir de keywords.ts, mais pour
 * suivre une fiche produit précise indépendamment de tout mot-clé.
 */
export function registerProductTrackingTools(server: McpServer, backend: BackendClient): void {
  server.registerTool(
    'list_tracked_urls',
    {
      title: 'URLs suivies individuellement',
      description:
        'Liste les URLs produit suivies individuellement (hors recherche par mot-clé), avec ' +
        "le dernier prix connu. Une URL absente de cette liste n'est pas suivie.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => runTool(async () => text(formatTrackedUrlSummaries(await backend.listTrackedUrls()))),
  );

  server.registerTool(
    'track_product_url',
    {
      title: 'Suivre une URL produit',
      description:
        'Ajoute une fiche produit au suivi individuel, indépendamment de tout mot-clé. ' +
        'Amazon.fr uniquement (URL contenant /dp/ASIN). Le scrapper la prendra en compte à sa ' +
        "prochaine exécution (DAG quotidien) : aucune donnée n'apparaît immédiatement.",
      inputSchema: {
        url: z.string().min(1).describe('URL de la fiche produit amazon.fr'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    ({ url }) =>
      runTool(async () => {
        await backend.trackProductUrl(url);
        return text('URL ajoutée au suivi individuel. Les données apparaîtront après le prochain scrape.');
      }),
  );

  server.registerTool(
    'untrack_product_url',
    {
      title: "Retirer une URL du suivi individuel",
      description:
        'Retire une URL du suivi individuel : le scrapper cesse de la relever. ' +
        "L'historique déjà collecté reste en base.",
      inputSchema: {
        id: z.string().min(1).describe('Identifiant opaque renvoyé par list_tracked_urls'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    ({ id }) =>
      runTool(async () => {
        await backend.untrackProductUrl(id);
        return text('URL retirée du suivi individuel.');
      }),
  );
}

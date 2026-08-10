import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { BackendClient } from '../backend/client.js';
import { formatFavorites } from '../format.js';
import { runTool, text } from './tool-result.js';

/**
 * Outils du contexte favorite : suivre l'évolution de prix d'un produit
 * précis dans le temps.
 *
 * Contrairement à track_keyword / track_product_url, add_favorite et
 * remove_favorite sont idempotents — mettre en favori un produit déjà
 * favori, ou en retirer un déjà absent, n'est pas une erreur (annotation
 * `idempotentHint: true`, `destructiveHint: false`).
 */
export function registerFavoriteTools(server: McpServer, backend: BackendClient): void {
  server.registerTool(
    'list_favorites',
    {
      title: 'Produits favoris',
      description:
        "Produits mis en favori, avec un aperçu récent de l'évolution de leur prix. Utiliser " +
        "get_product(id) pour l'historique complet d'un favori précis. Un favori tout juste " +
        'ajouté peut être absent le temps du prochain scrape.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => runTool(async () => text(formatFavorites(await backend.listFavorites()))),
  );

  server.registerTool(
    'add_favorite',
    {
      title: 'Ajouter un favori',
      description:
        'Met un produit en favori pour suivre son évolution de prix via list_favorites. ' +
        "Garantit aussi la continuité de son suivi, même si le mot-clé qui l'a fait découvrir " +
        'est retiré ensuite. Idempotent : refavoriser un produit déjà favori ne fait rien.',
      inputSchema: {
        id: z
          .string()
          .min(1)
          .describe(
            'Identifiant opaque du produit, renvoyé par search_products, get_product ou list_tracked_urls',
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    ({ id }) =>
      runTool(async () => {
        await backend.addFavorite(id);
        return text('Produit ajouté aux favoris.');
      }),
  );

  server.registerTool(
    'remove_favorite',
    {
      title: 'Retirer un favori',
      description:
        "Retire un produit des favoris. N'arrête pas son suivi de prix, seulement le signet — " +
        "l'historique continue d'être collecté. Idempotent.",
      inputSchema: {
        id: z.string().min(1).describe('Identifiant opaque du produit'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    ({ id }) =>
      runTool(async () => {
        await backend.removeFavorite(id);
        return text('Produit retiré des favoris.');
      }),
  );
}

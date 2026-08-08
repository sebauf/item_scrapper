import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { BackendClient } from '../backend/client.js';
import { formatDashboard, formatProductDetail, formatSearchResult } from '../format.js';
import { runTool, text } from './tool-result.js';

/**
 * Outils de lecture du contexte Catalog : tableau de bord, recherche de
 * produits, fiche produit. Tous en lecture seule — les produits et les prix
 * sont écrits par le scrapper et le pipeline, jamais par une API.
 */

const DEFAULT_HISTORY_DAYS = 30;

export function registerCatalogTools(server: McpServer, backend: BackendClient): void {
  server.registerTool(
    'get_dashboard',
    {
      title: 'Tableau de bord',
      description:
        "Vue d'ensemble du suivi de prix : nombre de mots-clés, de produits et de bonnes " +
        "affaires, date de la dernière exécution du pipeline, et les meilleures affaires " +
        'de chaque mot-clé. À appeler en premier pour savoir ce qui est disponible.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => runTool(async () => text(formatDashboard(await backend.getDashboard()))),
  );

  server.registerTool(
    'search_products',
    {
      title: 'Rechercher des produits',
      description:
        "Produits relevés pour un mot-clé suivi, filtrés, triés et paginés (24 par page). " +
        "Un mot-clé inconnu renvoie zéro résultat plutôt qu'une erreur : vérifier avec " +
        'list_keywords en cas de doute.',
      inputSchema: {
        keyword: z.string().min(1).describe('Mot-clé suivi, tel que renvoyé par list_keywords'),
        query: z.string().max(100).optional().describe('Filtre plein texte sur le titre'),
        dealsOnly: z.boolean().optional().describe('Ne garder que les bonnes affaires'),
        minPrice: z.number().nonnegative().optional().describe('Prix minimum'),
        maxPrice: z.number().nonnegative().optional().describe('Prix maximum'),
        sort: z
          .enum(['deals', 'price_asc', 'price_desc', 'discount'])
          .optional()
          .describe('Tri : deals (défaut), price_asc, price_desc, discount'),
        page: z.number().int().min(1).optional().describe('Page, à partir de 1'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ keyword, query, dealsOnly, minPrice, maxPrice, sort, page }) =>
      runTool(async () => {
        const result = await backend.searchProducts(keyword, {
          q: query,
          dealsOnly,
          minPrice,
          maxPrice,
          sort,
          page,
        });
        return text(formatSearchResult(keyword, result, page ?? 1));
      }),
  );

  server.registerTool(
    'get_product',
    {
      title: 'Fiche produit',
      description:
        "Détail d'un produit et son historique de prix. L'identifiant est l'`id` opaque " +
        'renvoyé par get_dashboard ou search_products — ce n\'est ni une URL ni un titre.',
      inputSchema: {
        id: z.string().min(1).describe('Identifiant opaque du produit'),
        historyDays: z
          .number()
          .int()
          .min(1)
          .max(365)
          .optional()
          .describe(`Nombre de relevés les plus récents à renvoyer (défaut ${DEFAULT_HISTORY_DAYS})`),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ id, historyDays }) =>
      runTool(async () => {
        const product = await backend.getProduct(id);
        return text(formatProductDetail(product, historyDays ?? DEFAULT_HISTORY_DAYS));
      }),
  );
}

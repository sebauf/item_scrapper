import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BackendClient } from './backend/client.js';
import { registerCatalogTools } from './tools/catalog.js';
import { registerFavoriteTools } from './tools/favorites.js';
import { registerKeywordTools } from './tools/keywords.js';
import { registerProductTrackingTools } from './tools/product-tracking.js';

export const SERVER_NAME = 'price-tracker';
export const SERVER_VERSION = '1.0.0';

/**
 * Instructions livrées au modèle au moment de l'initialisation MCP.
 *
 * C'est l'équivalent d'un README pour l'agent : le contexte qu'il ne peut pas
 * déduire de la seule signature des outils — d'où viennent les données, à
 * quelle fréquence elles bougent, ce que « bonne affaire » veut dire ici.
 */
const INSTRUCTIONS = `Suivi de prix de produits e-commerce (Amazon).

Un scrapper relève chaque jour les produits correspondant aux mots-clés suivis,
puis un pipeline reconstruit l'historique de prix et calcule un score d'affaire.

Le score compare le prix du jour à la moyenne glissante 30 jours *du même
produit* : un score positif signifie « moins cher que d'habitude ». Il n'y a
aucune comparaison entre produits différents. Un produit avec moins de
5 relevés n'a pas de score (dealScore null).

« BONNE AFFAIRE » est un verdict déjà appliqué par le serveur, il n'y a pas de
seuil à réinterpréter.

Les données ne changent qu'une fois par jour, après l'exécution du pipeline :
inutile de rappeler les outils en boucle. Commencer par get_dashboard pour
savoir ce qui est suivi, puis search_products pour creuser un mot-clé.

Ajouter un mot-clé ne produit aucun résultat immédiat : le scrape suivant le
prendra en compte.

Deux façons de suivre le prix d'un produit *précis*, en plus des mots-clés :
- track_product_url suit une fiche produit amazon.fr directement, sans passer
  par une recherche par mot-clé.
- add_favorite suit l'évolution de prix d'un produit déjà connu (trouvé via
  search_products, get_product ou list_tracked_urls) et le garde visible dans
  list_favorites ; il garantit aussi la continuité de son suivi. Contrairement
  à track_keyword/track_product_url, add_favorite et remove_favorite sont
  idempotents.`;

/**
 * Fabrique un serveur MCP neuf.
 *
 * Le transport HTTP est utilisé en mode *stateless* : une instance par requête,
 * ce qui évite que deux clients se marchent dessus sur les identifiants de
 * requête JSON-RPC. D'où une fabrique plutôt qu'un singleton.
 */
export function createMcpServer(backend: BackendClient): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );

  registerCatalogTools(server, backend);
  registerKeywordTools(server, backend);
  registerProductTrackingTools(server, backend);
  registerFavoriteTools(server, backend);

  return server;
}

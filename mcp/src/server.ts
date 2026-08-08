import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BackendClient } from './backend/client.js';
import { registerCatalogTools } from './tools/catalog.js';
import { registerKeywordTools } from './tools/keywords.js';

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
prendra en compte.`;

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

  return server;
}

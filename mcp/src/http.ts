import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { BackendClient } from './backend/client.js';
import type { McpConfig } from './config.js';
import { createMcpServer } from './server.js';

/**
 * Façade HTTP du serveur MCP.
 *
 * Trois routes seulement :
 *  - `/mcp`          transport « Streamable HTTP » du protocole MCP
 *  - `/health/live`  le processus répond
 *  - `/health/ready` le backend répond (mêmes sondes que les autres services)
 *
 * Pas de framework : le SDK travaille directement avec les objets `node:http`,
 * et les seules routes non-MCP sont deux sondes.
 */

const MCP_PATH = '/mcp';

export function createHttpServer(config: McpConfig, backend: BackendClient): Server {
  return createServer((req, res) => {
    void handle(req, res, config, backend).catch((error: unknown) => {
      logError('Requête non gérée', error);
      if (!res.headersSent) sendJson(res, 500, { error: 'internal_error' });
    });
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  config: McpConfig,
  backend: BackendClient,
): Promise<void> {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;

  if (path === '/health/live') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  if (path === '/health/ready') {
    const ready = await backend.isBackendReady();
    sendJson(res, ready ? 200 : 503, { status: ready ? 'ok' : 'backend_unavailable' });
    return;
  }

  if (path !== MCP_PATH) {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }

  if (!isAuthorised(req, config)) {
    // `WWW-Authenticate` indique au client MCP *comment* s'authentifier plutôt
    // que de le laisser deviner devant un 401 muet.
    res.setHeader('WWW-Authenticate', 'Bearer realm="price-tracker-mcp"');
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }

  await handleMcpRequest(req, res, config, backend);
}

/**
 * Mode stateless : un serveur MCP et un transport neufs à chaque requête, tous
 * deux fermés dès la réponse envoyée. Le prix est un objet jetable par appel ;
 * le gain est qu'aucun état ne survit entre deux clients, donc rien à
 * répliquer si on passe à plusieurs pods.
 */
async function handleMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: McpConfig,
  backend: BackendClient,
): Promise<void> {
  const server = createMcpServer(backend);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    // Sans nom d'hôte connu à l'avance, la protection anti-DNS rebinding reste
    // désactivée par défaut ; MCP_ALLOWED_HOSTS l'active sans rien coder en dur.
    enableDnsRebindingProtection: config.allowedHosts.length > 0,
    ...(config.allowedHosts.length > 0 ? { allowedHosts: [...config.allowedHosts] } : {}),
  });

  res.on('close', () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res);
}

/**
 * Comparaison à temps constant : un `===` fuite la longueur du préfixe correct
 * et rend le jeton devinable octet par octet.
 */
function isAuthorised(req: IncomingMessage, config: McpConfig): boolean {
  if (config.authToken === null) return true;

  const header = req.headers.authorization ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (match === null) return false;

  const provided = Buffer.from(match[1]);
  const expected = Buffer.from(config.authToken);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function logError(context: string, error: unknown): void {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[mcp] ${context} : ${message}`);
}

import { BackendClient } from './backend/client.js';
import { McpConfig } from './config.js';
import { createHttpServer, logError } from './http.js';
import { SERVER_NAME, SERVER_VERSION } from './server.js';

function bootstrap(): void {
  const config = McpConfig.fromEnv(process.env);
  const backend = new BackendClient({
    baseUrl: config.backendUrl,
    timeoutMs: config.backendTimeoutMs,
  });

  const server = createHttpServer(config, backend);

  server.listen(config.port, '0.0.0.0', () => {
    console.log(
      `[mcp] ${SERVER_NAME} v${SERVER_VERSION} prêt sur http://0.0.0.0:${config.port}/mcp ` +
        `(backend: ${config.backendUrl}, auth: ${config.authToken === null ? 'ANONYME' : 'bearer'})`,
    );
    if (config.authToken === null) {
      console.warn(
        "[mcp] MCP_ALLOW_ANONYMOUS=true : le serveur accepte n'importe quel appelant, " +
          'y compris sur les outils d\'écriture. À réserver au développement local.',
      );
    }
  });

  const shutdown = (signal: string): void => {
    console.log(`[mcp] ${signal} reçu, arrêt en cours…`);
    server.close(() => process.exit(0));
    // Filet de sécurité : un flux SSE encore ouvert ne doit pas bloquer l'arrêt
    // au-delà du délai de grâce de Kubernetes.
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

try {
  bootstrap();
} catch (error) {
  logError('Démarrage impossible', error);
  process.exit(1);
}

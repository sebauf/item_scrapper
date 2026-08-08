/**
 * Configuration du serveur MCP, validée une fois au démarrage.
 *
 * Même principe que `AppConfig` côté backend : une variable absente ou aberrante
 * empêche le démarrage avec un message explicite, plutôt que de produire un
 * `undefined` qui casse au premier appel d'outil.
 */
export class McpConfig {
  private constructor(
    /** Racine de l'API backend, sans `/api/v1` — le client l'ajoute. */
    readonly backendUrl: string,
    readonly port: number,
    /** `null` quand l'accès anonyme a été demandé explicitement. */
    readonly authToken: string | null,
    readonly backendTimeoutMs: number,
    /**
     * Hôtes acceptés dans l'en-tête `Host` (protection anti-DNS rebinding).
     * Vide = protection désactivée : c'est le défaut, parce qu'on ne connaît
     * pas le nom d'hôte de déploiement et qu'on ne veut rien coder en dur.
     */
    readonly allowedHosts: readonly string[],
  ) {}

  static fromEnv(env: NodeJS.ProcessEnv): McpConfig {
    const errors: string[] = [];

    const backendUrl = (env.BACKEND_URL ?? 'http://localhost:3001').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(backendUrl)) {
      errors.push('BACKEND_URL doit commencer par http:// ou https://.');
    }

    const rawPort = (env.PORT ?? '3010').trim();
    const port = Number(rawPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push(`PORT doit être un entier entre 1 et 65535 (reçu « ${rawPort} »).`);
    }

    // Le serveur est joignable depuis l'extérieur du cluster (c'est sa raison
    // d'être) et il expose des outils d'écriture : il refuse de démarrer sans
    // jeton, sauf renonciation explicite — jamais par simple oubli.
    const token = (env.MCP_AUTH_TOKEN ?? '').trim();
    const allowAnonymous = (env.MCP_ALLOW_ANONYMOUS ?? '').trim().toLowerCase() === 'true';
    if (!token && !allowAnonymous) {
      errors.push(
        'MCP_AUTH_TOKEN est requise (ou MCP_ALLOW_ANONYMOUS=true pour ouvrir le serveur sans jeton).',
      );
    } else if (token && token.length < 16) {
      errors.push('MCP_AUTH_TOKEN doit faire au moins 16 caractères.');
    }

    const rawTimeout = (env.BACKEND_TIMEOUT_MS ?? '10000').trim();
    const backendTimeoutMs = Number(rawTimeout);
    if (!Number.isInteger(backendTimeoutMs) || backendTimeoutMs < 100) {
      errors.push(`BACKEND_TIMEOUT_MS doit être un entier ≥ 100 (reçu « ${rawTimeout} »).`);
    }

    const allowedHosts = (env.MCP_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean);

    if (errors.length > 0) {
      throw new Error(`Configuration invalide :\n  - ${errors.join('\n  - ')}`);
    }

    return new McpConfig(
      backendUrl,
      port,
      allowAnonymous && !token ? null : token,
      backendTimeoutMs,
      Object.freeze(allowedHosts),
    );
  }
}

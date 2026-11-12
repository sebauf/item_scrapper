const DEFAULT_BACKEND_URL = 'http://localhost:3001';
const DEFAULT_PORT = 3010;
const DEFAULT_BACKEND_TIMEOUT_MS = 10_000;

/** En deçà, chaque appel échouerait avant que le backend ait pu répondre. */
const MIN_BACKEND_TIMEOUT_MS = 100;

/**
 * Le jeton d'accès protège un serveur exposé hors du cluster, outils
 * d'écriture compris : trop court, il se devine (`openssl rand -hex 32` en
 * donne 64 caractères).
 */
const MIN_AUTH_TOKEN_LENGTH = 16;

/** Même plancher que le backend, qui refuse un secret de signature plus court. */
const MIN_BACKEND_SECRET_LENGTH = 32;

interface McpConfigValues {
  backendUrl: string;
  port: number;
  authToken: string | null;
  backendTimeoutMs: number;
  allowedHosts: readonly string[];
  backendAuthSecret: string;
  userEmail: string;
}

/**
 * Configuration du serveur MCP, validée une fois au démarrage.
 *
 * Même principe que `AppConfig` côté backend : une variable absente ou aberrante
 * empêche le démarrage avec un message explicite, plutôt que de produire un
 * `undefined` qui casse au premier appel d'outil. Toutes les erreurs sont
 * rapportées en une fois.
 */
export class McpConfig {
  /** Racine de l'API backend, sans `/api/v1` — le client l'ajoute. */
  readonly backendUrl: string;
  readonly port: number;
  /** `null` quand l'accès anonyme a été demandé explicitement. */
  readonly authToken: string | null;
  readonly backendTimeoutMs: number;
  /**
   * Hôtes acceptés dans l'en-tête `Host` (protection anti-DNS rebinding).
   * Vide = protection désactivée : c'est le défaut, parce qu'on ne connaît
   * pas le nom d'hôte de déploiement et qu'on ne veut rien coder en dur.
   */
  readonly allowedHosts: readonly string[];
  /**
   * Secret propre au MCP, connu du backend (`MCP_BACKEND_AUTH_SECRET`) :
   * signe le jeton interne de chaque appel. Distinct de celui du frontend —
   * le backend n'accepte ce secret que pour `userEmail`.
   */
  readonly backendAuthSecret: string;
  /**
   * Compte au nom duquel agissent les outils : ce sont ses mots-clés, ses
   * favoris, ses URLs suivies et ses stations que l'agent lit et modifie.
   */
  readonly userEmail: string;

  private constructor(values: McpConfigValues) {
    this.backendUrl = values.backendUrl;
    this.port = values.port;
    this.authToken = values.authToken;
    this.backendTimeoutMs = values.backendTimeoutMs;
    this.allowedHosts = Object.freeze([...values.allowedHosts]);
    this.backendAuthSecret = values.backendAuthSecret;
    this.userEmail = values.userEmail;
  }

  static fromEnv(env: NodeJS.ProcessEnv): McpConfig {
    // L'ordre des lectures est celui des messages d'erreur.
    const reader = new EnvReader(env);
    const backendUrl = readBackendUrl(reader);
    const port = readPort(reader);
    const authToken = readAuthToken(reader);
    const backendTimeoutMs = readBackendTimeout(reader);
    const allowedHosts = reader.list('MCP_ALLOWED_HOSTS');
    const backendAuthSecret = readBackendAuthSecret(reader);
    const userEmail = readUserEmail(reader);
    reader.assertValid();

    return new McpConfig({
      backendUrl,
      port,
      authToken,
      backendTimeoutMs,
      allowedHosts,
      backendAuthSecret,
      userEmail,
    });
  }
}

/** Lit l'environnement et note les erreurs, pour les rapporter toutes ensemble. */
class EnvReader {
  private readonly errors: string[] = [];

  constructor(private readonly env: NodeJS.ProcessEnv) {}

  text(name: string, fallback = ''): string {
    return (this.env[name] ?? fallback).trim();
  }

  list(name: string): string[] {
    return this.text(name)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  fail(message: string): void {
    this.errors.push(message);
  }

  assertValid(): void {
    if (this.errors.length === 0) return;
    throw new Error(`Configuration invalide :\n  - ${this.errors.join('\n  - ')}`);
  }
}

function readBackendUrl(reader: EnvReader): string {
  const url = reader.text('BACKEND_URL', DEFAULT_BACKEND_URL).replace(/\/+$/, '');
  if (!/^https?:\/\//.test(url)) reader.fail('BACKEND_URL doit commencer par http:// ou https://.');
  return url;
}

function readPort(reader: EnvReader): number {
  const raw = reader.text('PORT', String(DEFAULT_PORT));
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    reader.fail(`PORT doit être un entier entre 1 et 65535 (reçu « ${raw} »).`);
  }
  return port;
}

/**
 * Le serveur est joignable depuis l'extérieur du cluster (c'est sa raison
 * d'être) et il expose des outils d'écriture : il refuse de démarrer sans
 * jeton, sauf renonciation explicite — jamais par simple oubli.
 *
 * @returns `null` pour un accès anonyme demandé explicitement
 */
function readAuthToken(reader: EnvReader): string | null {
  const token = reader.text('MCP_AUTH_TOKEN');
  const allowAnonymous = reader.text('MCP_ALLOW_ANONYMOUS').toLowerCase() === 'true';
  if (!token && !allowAnonymous) {
    reader.fail(
      'MCP_AUTH_TOKEN est requise (ou MCP_ALLOW_ANONYMOUS=true pour ouvrir le serveur sans jeton).',
    );
  } else if (token && token.length < MIN_AUTH_TOKEN_LENGTH) {
    reader.fail(`MCP_AUTH_TOKEN doit faire au moins ${MIN_AUTH_TOKEN_LENGTH} caractères.`);
  }
  return allowAnonymous && !token ? null : token;
}

function readBackendTimeout(reader: EnvReader): number {
  const raw = reader.text('BACKEND_TIMEOUT_MS', String(DEFAULT_BACKEND_TIMEOUT_MS));
  const timeoutMs = Number(raw);
  if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_BACKEND_TIMEOUT_MS) {
    reader.fail(`BACKEND_TIMEOUT_MS doit être un entier ≥ ${MIN_BACKEND_TIMEOUT_MS} (reçu « ${raw} »).`);
  }
  return timeoutMs;
}

/**
 * Le backend refuse toute requête sans jeton signé : sans ce secret et le
 * compte, chaque outil échouerait en 401. Autant le dire au démarrage.
 */
function readBackendAuthSecret(reader: EnvReader): string {
  const secret = reader.text('MCP_BACKEND_AUTH_SECRET');
  if (secret.length < MIN_BACKEND_SECRET_LENGTH) {
    reader.fail(
      `MCP_BACKEND_AUTH_SECRET est requise (même valeur que côté backend, ${MIN_BACKEND_SECRET_LENGTH} caractères minimum).`,
    );
  }
  return secret;
}

function readUserEmail(reader: EnvReader): string {
  const email = reader.text('MCP_USER_EMAIL').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    reader.fail("MCP_USER_EMAIL est requise : l'adresse Google du compte au nom duquel l'agent agit.");
  }
  return email;
}

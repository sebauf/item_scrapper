import { UserId } from 'src/shared/domain/user-id';
import {
  FRONTEND_ISSUER,
  MCP_ISSUER,
  TokenIssuer,
} from 'src/shared/infrastructure/auth/internal-token';

/** Nom de base unique du projet, en dur aussi dans le scrapper et le pipeline. */
const DEFAULT_DATABASE = 'scrapper';
const DEFAULT_PORT = 3001;

/**
 * Longueur minimale d'un secret de signature : une clé HS256 plus courte que
 * le condensat (256 bits) affaiblit la signature (RFC 7518 §3.2).
 */
const MIN_SECRET_LENGTH = 32;

/**
 * Quotas par défaut. Le budget de crawl est commun (`MAX_REQUESTS_PER_CRAWL` =
 * 1000 pages, cf. scrapper/…/AmazonCrawler.ts) et un mot-clé en coûte ~155 au
 * pire, une URL suivie 1 : un compte ne doit pas pouvoir affamer les autres.
 */
const DEFAULT_MAX_KEYWORDS_PER_USER = 10;
const DEFAULT_MAX_TRACKED_URLS_PER_USER = 100;

interface AppConfigValues {
  mongodbUri: string;
  mongodbDatabase: string;
  port: number;
  corsOrigins: readonly string[];
  authSecret: string;
  legacyOwnerEmail: UserId | null;
  mcpAuthSecret: string | null;
  mcpUserEmail: UserId | null;
  maxKeywordsPerUser: number;
  maxTrackedUrlsPerUser: number;
}

/**
 * Configuration applicative, validée une fois au démarrage.
 *
 * Le principe : si une variable d'environnement est absente ou invalide, le
 * processus refuse de démarrer avec un message explicite, plutôt que de crasher
 * plus tard sur un `undefined` au premier appel HTTP. Toutes les erreurs sont
 * rapportées en une fois.
 */
export class AppConfig {
  readonly mongodbUri: string;
  readonly mongodbDatabase: string;
  readonly port: number;
  readonly corsOrigins: readonly string[];
  /**
   * Secret HMAC du **frontend** : il signe le jeton interne qui porte
   * l'identité de l'utilisateur (cf. shared/infrastructure/auth/internal-token.ts).
   * Le MCP a le sien, `mcpAuthSecret`.
   */
  readonly authSecret: string;
  /**
   * Propriétaire des données antérieures à l'authentification (mots-clés,
   * favoris… sans utilisateur). `null` : rien n'est réattribué.
   */
  readonly legacyOwnerEmail: UserId | null;
  /**
   * Secret propre au serveur MCP, distinct de `authSecret`. `null` : le
   * backend refuse tout jeton du MCP.
   */
  readonly mcpAuthSecret: string | null;
  /** Seul compte au nom duquel le MCP peut agir. Requis avec `mcpAuthSecret`. */
  readonly mcpUserEmail: UserId | null;
  /** Abonnements à des mots-clés par utilisateur. 0 = illimité. */
  readonly maxKeywordsPerUser: number;
  /** URLs suivies à l'unité par utilisateur (favoris compris). 0 = illimité. */
  readonly maxTrackedUrlsPerUser: number;

  private constructor(values: AppConfigValues) {
    this.mongodbUri = values.mongodbUri;
    this.mongodbDatabase = values.mongodbDatabase;
    this.port = values.port;
    this.corsOrigins = Object.freeze([...values.corsOrigins]);
    this.authSecret = values.authSecret;
    this.legacyOwnerEmail = values.legacyOwnerEmail;
    this.mcpAuthSecret = values.mcpAuthSecret;
    this.mcpUserEmail = values.mcpUserEmail;
    this.maxKeywordsPerUser = values.maxKeywordsPerUser;
    this.maxTrackedUrlsPerUser = values.maxTrackedUrlsPerUser;
  }

  /**
   * Émetteurs de jetons acceptés : le frontend (tout utilisateur) et, s'il est
   * configuré, le MCP (son seul compte). Cf. internal-token.ts.
   */
  get tokenIssuers(): TokenIssuer[] {
    const issuers: TokenIssuer[] = [{ issuer: FRONTEND_ISSUER, secret: this.authSecret }];
    if (this.mcpAuthSecret !== null && this.mcpUserEmail !== null) {
      issuers.push({
        issuer: MCP_ISSUER,
        secret: this.mcpAuthSecret,
        onlySubject: this.mcpUserEmail,
      });
    }
    return issuers;
  }

  static fromEnv(env: NodeJS.ProcessEnv): AppConfig {
    // L'ordre des lectures est celui des messages d'erreur.
    const reader = new EnvReader(env);
    const mongodbUri = readMongodbUri(reader);
    const mongodbDatabase = readDatabase(reader);
    const port = readPort(reader);
    const corsOrigins = reader.list('CORS_ORIGINS');
    const authSecret = readAuthSecret(reader);
    const legacyOwnerEmail = readLegacyOwner(reader);
    const mcpAccess = readMcpAccess(reader, authSecret);
    const maxKeywordsPerUser = reader.nonNegativeInt(
      'MAX_KEYWORDS_PER_USER',
      DEFAULT_MAX_KEYWORDS_PER_USER,
    );
    const maxTrackedUrlsPerUser = reader.nonNegativeInt(
      'MAX_TRACKED_URLS_PER_USER',
      DEFAULT_MAX_TRACKED_URLS_PER_USER,
    );
    reader.assertValid();

    return new AppConfig({
      mongodbUri,
      mongodbDatabase,
      port,
      corsOrigins,
      authSecret,
      legacyOwnerEmail,
      ...mcpAccess,
      maxKeywordsPerUser,
      maxTrackedUrlsPerUser,
    });
  }
}

/** Lit l'environnement et note les erreurs, pour les rapporter toutes ensemble. */
class EnvReader {
  private readonly errors: string[] = [];

  constructor(private readonly env: NodeJS.ProcessEnv) {}

  raw(name: string): string | undefined {
    return this.env[name];
  }

  text(name: string, fallback = ''): string {
    return (this.env[name] ?? fallback).trim();
  }

  list(name: string): string[] {
    return this.text(name)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  nonNegativeInt(name: string, fallback: number): number {
    const value = this.text(name);
    if (!value) return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      this.fail(`${name} doit être un entier positif ou nul (reçu « ${value} »), 0 = illimité.`);
      return fallback;
    }
    return parsed;
  }

  fail(message: string): void {
    this.errors.push(message);
  }

  assertValid(): void {
    if (this.errors.length === 0) return;
    throw new Error(`Configuration invalide :\n  - ${this.errors.join('\n  - ')}`);
  }
}

function readMongodbUri(reader: EnvReader): string {
  const uri = reader.text('MONGODB_URI');
  if (!uri) {
    reader.fail('MONGODB_URI est requise.');
  } else if (!/^mongodb(\+srv)?:\/\//.test(uri)) {
    reader.fail('MONGODB_URI doit commencer par mongodb:// ou mongodb+srv://.');
  }
  return uri;
}

function readDatabase(reader: EnvReader): string {
  const database = reader.text('MONGODB_DATABASE', DEFAULT_DATABASE);
  if (!database) reader.fail('MONGODB_DATABASE ne peut pas être vide.');
  return database;
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
 * Pas de mode « sans authentification » : sans secret, n'importe quel Pod du
 * cluster pourrait lire et modifier les données de tous les comptes.
 */
function readAuthSecret(reader: EnvReader): string {
  const secret = reader.text('BACKEND_AUTH_SECRET');
  if (secret.length < MIN_SECRET_LENGTH) {
    reader.fail(
      `BACKEND_AUTH_SECRET est requise et doit faire au moins ${MIN_SECRET_LENGTH} caractères (openssl rand -hex 32).`,
    );
  }
  return secret;
}

function readLegacyOwner(reader: EnvReader): UserId | null {
  const raw = reader.text('AUTH_LEGACY_OWNER_EMAIL');
  if (!raw) return null;
  try {
    return UserId.create(raw);
  } catch {
    reader.fail(`AUTH_LEGACY_OWNER_EMAIL n'est pas une adresse e-mail (reçu « ${raw} »).`);
    return null;
  }
}

/**
 * Secret propre au MCP : s'il valait `authSecret`, un Pod MCP compromis
 * pourrait signer au nom du frontend, donc de n'importe qui.
 */
function readMcpAccess(
  reader: EnvReader,
  authSecret: string,
): Pick<AppConfigValues, 'mcpAuthSecret' | 'mcpUserEmail'> {
  const mcpAuthSecret = reader.text('MCP_BACKEND_AUTH_SECRET') || null;
  if (mcpAuthSecret === null) return { mcpAuthSecret, mcpUserEmail: null };

  if (mcpAuthSecret.length < MIN_SECRET_LENGTH) {
    reader.fail(`MCP_BACKEND_AUTH_SECRET doit faire au moins ${MIN_SECRET_LENGTH} caractères.`);
  }
  if (mcpAuthSecret === authSecret) {
    reader.fail(
      'MCP_BACKEND_AUTH_SECRET doit différer de BACKEND_AUTH_SECRET : sinon le MCP peut agir au nom de tous les comptes.',
    );
  }
  try {
    return { mcpAuthSecret, mcpUserEmail: UserId.create(reader.raw('MCP_USER_EMAIL')) };
  } catch {
    reader.fail(
      'MCP_USER_EMAIL est requise avec MCP_BACKEND_AUTH_SECRET (adresse du compte du MCP).',
    );
    return { mcpAuthSecret, mcpUserEmail: null };
  }
}

import { UserId } from 'src/shared/domain/user-id';
import {
  FRONTEND_ISSUER,
  MCP_ISSUER,
  TokenIssuer,
} from 'src/shared/infrastructure/auth/internal-token';

/**
 * Configuration applicative, validée une fois au démarrage.
 *
 * Le principe : si une variable d'environnement est absente ou invalide, le
 * processus refuse de démarrer avec un message explicite, plutôt que de crasher
 * plus tard sur un `undefined` au premier appel HTTP.
 */
export class AppConfig {
  private constructor(
    readonly mongodbUri: string,
    readonly mongodbDatabase: string,
    readonly port: number,
    readonly corsOrigins: readonly string[],
    /**
     * Secret HMAC partagé avec le frontend et le serveur MCP : il signe le
     * jeton interne qui porte l'identité de l'utilisateur (cf.
     * shared/infrastructure/auth/internal-token.ts).
     */
    readonly authSecret: string,
    /**
     * Propriétaire des données antérieures à l'authentification (mots-clés,
     * favoris… sans utilisateur). `null` : rien n'est réattribué.
     */
    readonly legacyOwnerEmail: UserId | null,
    /**
     * Secret propre au serveur MCP, distinct de `authSecret`. `null` : le
     * backend refuse tout jeton du MCP.
     */
    readonly mcpAuthSecret: string | null,
    /** Seul compte au nom duquel le MCP peut agir. Requis avec `mcpAuthSecret`. */
    readonly mcpUserEmail: UserId | null,
    /** Abonnements à des mots-clés par utilisateur. 0 = illimité. */
    readonly maxKeywordsPerUser: number,
    /** URLs suivies à l'unité par utilisateur (favoris compris). 0 = illimité. */
    readonly maxTrackedUrlsPerUser: number,
  ) {}

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
    const errors: string[] = [];

    const mongodbUri = (env.MONGODB_URI ?? '').trim();
    if (!mongodbUri) {
      errors.push('MONGODB_URI est requise.');
    } else if (!/^mongodb(\+srv)?:\/\//.test(mongodbUri)) {
      errors.push('MONGODB_URI doit commencer par mongodb:// ou mongodb+srv://.');
    }

    const mongodbDatabase = (env.MONGODB_DATABASE ?? 'scrapper').trim();
    if (!mongodbDatabase) errors.push('MONGODB_DATABASE ne peut pas être vide.');

    const rawPort = (env.PORT ?? '3001').trim();
    const port = Number(rawPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push(`PORT doit être un entier entre 1 et 65535 (reçu « ${rawPort} »).`);
    }

    const corsOrigins = (env.CORS_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);

    // Pas de mode « sans authentification » : sans secret, n'importe quel Pod
    // du cluster pourrait lire et modifier les données de tous les comptes.
    const authSecret = (env.BACKEND_AUTH_SECRET ?? '').trim();
    if (authSecret.length < 32) {
      errors.push(
        'BACKEND_AUTH_SECRET est requise et doit faire au moins 32 caractères (openssl rand -hex 32).',
      );
    }

    let legacyOwnerEmail: UserId | null = null;
    const rawOwner = (env.AUTH_LEGACY_OWNER_EMAIL ?? '').trim();
    if (rawOwner) {
      try {
        legacyOwnerEmail = UserId.create(rawOwner);
      } catch {
        errors.push(`AUTH_LEGACY_OWNER_EMAIL n'est pas une adresse e-mail (reçu « ${rawOwner} »).`);
      }
    }

    // Secret propre au MCP : s'il valait `authSecret`, un Pod MCP compromis
    // pourrait signer au nom du frontend, donc de n'importe qui.
    const rawMcpSecret = (env.MCP_BACKEND_AUTH_SECRET ?? '').trim();
    const mcpAuthSecret = rawMcpSecret || null;
    let mcpUserEmail: UserId | null = null;
    if (mcpAuthSecret !== null) {
      if (mcpAuthSecret.length < 32) {
        errors.push('MCP_BACKEND_AUTH_SECRET doit faire au moins 32 caractères.');
      }
      if (mcpAuthSecret === authSecret) {
        errors.push(
          'MCP_BACKEND_AUTH_SECRET doit différer de BACKEND_AUTH_SECRET : sinon le MCP peut agir au nom de tous les comptes.',
        );
      }
      try {
        mcpUserEmail = UserId.create(env.MCP_USER_EMAIL);
      } catch {
        errors.push('MCP_USER_EMAIL est requise avec MCP_BACKEND_AUTH_SECRET (adresse du compte du MCP).');
      }
    }

    const maxKeywordsPerUser = nonNegativeInt(env.MAX_KEYWORDS_PER_USER, 10, 'MAX_KEYWORDS_PER_USER', errors);
    const maxTrackedUrlsPerUser = nonNegativeInt(
      env.MAX_TRACKED_URLS_PER_USER,
      100,
      'MAX_TRACKED_URLS_PER_USER',
      errors,
    );

    if (errors.length > 0) {
      throw new Error(`Configuration invalide :\n  - ${errors.join('\n  - ')}`);
    }

    return new AppConfig(
      mongodbUri,
      mongodbDatabase,
      port,
      Object.freeze(corsOrigins),
      authSecret,
      legacyOwnerEmail,
      mcpAuthSecret,
      mcpUserEmail,
      maxKeywordsPerUser,
      maxTrackedUrlsPerUser,
    );
  }
}

function nonNegativeInt(
  raw: string | undefined,
  fallback: number,
  name: string,
  errors: string[],
): number {
  const value = (raw ?? '').trim();
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    errors.push(`${name} doit être un entier positif ou nul (reçu « ${value} »), 0 = illimité.`);
    return fallback;
  }
  return parsed;
}

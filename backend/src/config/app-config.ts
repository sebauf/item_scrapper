import { UserId } from 'src/shared/domain/user-id';

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
  ) {}

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
    );
  }
}

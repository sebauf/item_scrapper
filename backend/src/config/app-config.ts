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
     * Jeton exigé par les routes d'administration (mise à jour de
     * l'application). `null` = ces routes sont fermées : la fonctionnalité est
     * optionnelle, son absence ne doit pas empêcher l'API de démarrer.
     */
    readonly adminToken: string | null,
    /**
     * Fichier `.dockerconfigjson` (le pull secret GHCR monté en volume) donnant
     * accès aux packages privés pour comparer les versions d'images. Absent =
     * accès anonyme, suffisant pour des packages publics.
     */
    readonly registryAuthFile: string,
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

    const adminToken = (env.ADMIN_TOKEN ?? '').trim() || null;
    if (adminToken !== null && adminToken.length < 16) {
      errors.push('ADMIN_TOKEN doit faire au moins 16 caractères (openssl rand -hex 32).');
    }

    const registryAuthFile = (
      env.REGISTRY_AUTH_FILE ?? '/var/run/secrets/registry/.dockerconfigjson'
    ).trim();

    if (errors.length > 0) {
      throw new Error(`Configuration invalide :\n  - ${errors.join('\n  - ')}`);
    }

    return new AppConfig(
      mongodbUri,
      mongodbDatabase,
      port,
      Object.freeze(corsOrigins),
      adminToken,
      registryAuthFile,
    );
  }
}

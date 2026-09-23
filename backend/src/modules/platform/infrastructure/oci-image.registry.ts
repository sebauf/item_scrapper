import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { AppConfig } from 'src/config/app-config';
import { ImageRegistry } from '../application/ports/image-registry';
import { ImageReference } from './image-reference';

/**
 * Types de manifeste acceptés. L'index (multi-architecture, ou ajouté par
 * buildx pour les attestations) doit figurer en tête : c'est son digest que le
 * runtime enregistre au moment du pull, donc c'est lui qu'il faut comparer.
 */
const MANIFEST_TYPES = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

/** Un tag ne bouge qu'à chaque build CI : inutile d'interroger le registre à chaque page. */
const SUCCESS_TTL_MS = 5 * 60_000;
/** Un registre en panne est réinterrogé plus tôt, sans l'être à chaque requête. */
const FAILURE_TTL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 5_000;

interface CacheEntry {
  digest: string | null;
  expiresAt: number;
}

interface DockerConfig {
  auths?: Record<string, { auth?: string; username?: string; password?: string }>;
}

/**
 * Client minimal de la Distribution API (OCI / Docker Registry v2), commune à
 * GHCR, Docker Hub et aux autres registres.
 *
 * Une seule question lui est posée : « vers quel digest pointe ce tag ? ». Un
 * `HEAD` sur le manifeste y répond via l'en-tête `Docker-Content-Digest`, sans
 * télécharger l'image. Si le registre exige une authentification, il répond
 * 401 avec un en-tête `WWW-Authenticate` qui indique où obtenir un jeton ; on
 * suit ce protocole plutôt que de coder en dur le fonctionnement de GHCR.
 */
@Injectable()
export class OciImageRegistry extends ImageRegistry {
  private readonly logger = new Logger(OciImageRegistry.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly config: AppConfig) {
    super();
  }

  async latestDigest(image: string): Promise<string | null> {
    const cached = this.cache.get(image);
    if (cached && cached.expiresAt > Date.now()) return cached.digest;

    let digest: string | null = null;
    try {
      digest = await this.resolve(ImageReference.parse(image));
    } catch (error) {
      this.logger.warn(`Digest de ${image} indisponible : ${(error as Error).message}`);
    }

    this.cache.set(image, {
      digest,
      expiresAt: Date.now() + (digest === null ? FAILURE_TTL_MS : SUCCESS_TTL_MS),
    });
    return digest;
  }

  private async resolve(ref: ImageReference): Promise<string> {
    // Une image épinglée par digest ne peut pas « avoir une nouvelle version ».
    if (ref.digest !== null) return ref.digest;

    const url = `https://${ref.apiHost}/v2/${ref.repository}/manifests/${encodeURIComponent(ref.tag)}`;
    const credentials = this.credentialsFor(ref.registry);

    let response = await this.head(url);
    if (response.status === 401) {
      const authorization = await this.authorize(
        response.headers.get('www-authenticate'),
        credentials,
      );
      response = await this.head(url, authorization);
    }
    if (!response.ok) throw new Error(`HEAD ${url} → HTTP ${response.status}`);

    const digest = response.headers.get('docker-content-digest');
    if (!digest) throw new Error(`HEAD ${url} : en-tête Docker-Content-Digest absent`);
    return digest;
  }

  private head(url: string, authorization?: string): Promise<Response> {
    return fetch(url, {
      method: 'HEAD',
      headers: { accept: MANIFEST_TYPES, ...(authorization ? { authorization } : {}) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  /** Transforme le défi `WWW-Authenticate` en en-tête `Authorization`. */
  private async authorize(challenge: string | null, credentials: string | null): Promise<string> {
    if (challenge === null) throw new Error('401 sans en-tête WWW-Authenticate');

    if (/^basic\b/i.test(challenge)) {
      if (credentials === null) throw new Error('le registre exige des identifiants');
      return `Basic ${credentials}`;
    }

    const params = parseChallenge(challenge);
    if (!params.realm) throw new Error(`défi d'authentification illisible : ${challenge}`);

    const tokenUrl = new URL(params.realm);
    if (params.service) tokenUrl.searchParams.set('service', params.service);
    if (params.scope) tokenUrl.searchParams.set('scope', params.scope);

    // Sans identifiants, le registre délivre un jeton anonyme (packages publics).
    const response = await fetch(tokenUrl, {
      headers: credentials ? { authorization: `Basic ${credentials}` } : {},
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`jeton refusé par ${tokenUrl.host} (HTTP ${response.status})`);

    const body = (await response.json()) as { token?: string; access_token?: string };
    const token = body.token ?? body.access_token;
    if (!token) throw new Error(`réponse de ${tokenUrl.host} sans jeton`);
    return `Bearer ${token}`;
  }

  /**
   * `user:password` en base64, lu dans le `.dockerconfigjson` du pull secret.
   * Relu à chaque résolution (rare, grâce au cache) : un secret renouvelé est
   * pris en compte sans redémarrer.
   */
  private credentialsFor(registry: string): string | null {
    let config: DockerConfig;
    try {
      config = JSON.parse(readFileSync(this.config.registryAuthFile, 'utf8')) as DockerConfig;
    } catch {
      return null; // pas de pull secret : accès anonyme
    }

    for (const [key, entry] of Object.entries(config.auths ?? {})) {
      // Les clés peuvent être `ghcr.io` comme `https://ghcr.io/v1/`.
      const host = key.replace(/^https?:\/\//, '').split('/')[0];
      if (host !== registry) continue;
      if (entry.auth) return entry.auth;
      if (entry.username && entry.password) {
        return Buffer.from(`${entry.username}:${entry.password}`).toString('base64');
      }
    }
    return null;
  }
}

/** `Bearer realm="…",service="…",scope="…"` → { realm, service, scope }. */
export function parseChallenge(challenge: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const match of challenge.matchAll(/(\w+)="([^"]*)"/g)) params[match[1]] = match[2];
  return params;
}

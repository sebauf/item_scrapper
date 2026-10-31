import { createHmac, timingSafeEqual } from 'node:crypto';
import { UserId } from 'src/shared/domain/user-id';

/**
 * Jeton interne frontend/MCP → backend.
 *
 * Le backend ne parle jamais à Google. C'est le frontend (Auth.js) qui
 * authentifie l'utilisateur ; à chaque appel d'API, il signe un jeton court
 * (JWT HS256, 60 s) qui dit « cette requête est faite au nom de telle adresse ».
 * Le backend vérifie la signature avec le secret partagé `BACKEND_AUTH_SECRET`
 * et n'accepte rien d'autre — un en-tête `X-User` en clair suffirait tant que le
 * backend reste un Service ClusterIP, mais ne tiendrait plus le jour où un autre
 * Pod du namespace serait compromis ou où le Service serait exposé par erreur.
 *
 * Pourquoi pas le jeton d'identité Google lui-même ? Il expire au bout d'une
 * heure et Auth.js ne le rafraîchit pas : la session (30 jours) lui survivrait,
 * et chaque appel au-delà de la première heure serait refusé.
 *
 * Implémenté avec `node:crypto` plutôt qu'avec une bibliothèque JWT : on ne
 * vérifie qu'un seul algorithme, connu d'avance, et c'est précisément
 * l'acceptation d'algorithmes multiples (`alg: none`, confusion RS/HS) qui fait
 * les failles classiques de JWT. L'en-tête est donc comparé à une valeur fixe.
 */

/** Audience attendue : un jeton signé pour un autre service est refusé. */
export const INTERNAL_TOKEN_AUDIENCE = 'price-tracker-backend';

/** Tolérance d'horloge entre Pods, en secondes. */
const CLOCK_SKEW_SECONDS = 30;

/** Durée de vie maximale acceptée — refuse un jeton forgé « pour toujours ». */
const MAX_LIFETIME_SECONDS = 15 * 60;

export interface InternalIdentity {
  userId: UserId;
  /** Émetteur déclaré (`price-tracker-frontend`, `price-tracker-mcp`) — pour les journaux. */
  issuer: string;
}

export class InvalidInternalToken extends Error {
  constructor(reason: string) {
    super(`Jeton invalide : ${reason}.`);
    this.name = 'InvalidInternalToken';
  }
}

const EXPECTED_HEADER = { alg: 'HS256', typ: 'JWT' };

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(signingInput: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(signingInput).digest();
}

/**
 * Fabrique un jeton. Sert aux tests et au script `npm run token` ; le frontend
 * et le serveur MCP ont leur propre copie (quelques lignes), pour ne pas
 * partager de paquet entre trois projets npm indépendants.
 */
export function signInternalToken(
  claims: { sub: string; iss: string; name?: string },
  secret: string,
  now: Date = new Date(),
  lifetimeSeconds = 60,
): string {
  const iat = Math.floor(now.getTime() / 1000);
  const header = base64url(JSON.stringify(EXPECTED_HEADER));
  const payload = base64url(
    JSON.stringify({ ...claims, aud: INTERNAL_TOKEN_AUDIENCE, iat, exp: iat + lifetimeSeconds }),
  );
  return `${header}.${payload}.${base64url(sign(`${header}.${payload}`, secret))}`;
}

export function verifyInternalToken(
  token: string,
  secret: string,
  now: Date = new Date(),
): InternalIdentity {
  const parts = token.split('.');
  if (parts.length !== 3) throw new InvalidInternalToken('format');
  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  // Signature d'abord : rien de ce que contient un jeton non authentifié ne
  // mérite d'être interprété.
  const expected = sign(`${encodedHeader}.${encodedPayload}`, secret);
  const actual = Buffer.from(encodedSignature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new InvalidInternalToken('signature');
  }

  const header = parseJson(encodedHeader);
  if (header.alg !== EXPECTED_HEADER.alg || (header.typ ?? 'JWT') !== EXPECTED_HEADER.typ) {
    throw new InvalidInternalToken('algorithme');
  }

  const payload = parseJson(encodedPayload);
  if (payload.aud !== INTERNAL_TOKEN_AUDIENCE) throw new InvalidInternalToken('audience');

  const nowSeconds = Math.floor(now.getTime() / 1000);
  const { iat, exp } = payload;
  if (typeof exp !== 'number' || typeof iat !== 'number') {
    throw new InvalidInternalToken('dates absentes');
  }
  if (exp < nowSeconds - CLOCK_SKEW_SECONDS) throw new InvalidInternalToken('expiré');
  if (iat > nowSeconds + CLOCK_SKEW_SECONDS) throw new InvalidInternalToken('émis dans le futur');
  if (exp - iat > MAX_LIFETIME_SECONDS) throw new InvalidInternalToken('durée de vie excessive');

  let userId: UserId;
  try {
    userId = UserId.create(payload.sub);
  } catch {
    throw new InvalidInternalToken('sujet');
  }

  return { userId, issuer: typeof payload.iss === 'string' ? payload.iss : 'inconnu' };
}

function parseJson(segment: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    if (value === null || typeof value !== 'object') throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new InvalidInternalToken('contenu illisible');
  }
}

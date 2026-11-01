import 'server-only';
import { createHmac } from 'node:crypto';

/**
 * Jeton interne frontend → backend : « cette requête est faite au nom de
 * telle adresse ».
 *
 * Le backend ne voit jamais le cookie de session ni Google : il vérifie
 * seulement ce jeton HS256, signé avec le secret partagé `BACKEND_AUTH_SECRET`
 * (contrat : backend/src/shared/infrastructure/auth/internal-token.ts). Durée
 * de vie de 60 s — il est refait à chaque appel, son vol n'ouvrirait qu'une
 * fenêtre d'une minute.
 *
 * `node:crypto` : ce module n'est importé que côté serveur Node (Server
 * Components, Server Actions), jamais par le middleware Edge ni le navigateur
 * — ce que garantit `import 'server-only'` (échec du build sinon).
 */
export const INTERNAL_TOKEN_ISSUER = 'price-tracker-frontend';
const AUDIENCE = 'price-tracker-backend';
const LIFETIME_SECONDS = 60;

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function signInternalToken(email: string, secret: string, now: Date = new Date()): string {
  const iat = Math.floor(now.getTime() / 1000);
  const header = base64url({ alg: 'HS256', typ: 'JWT' });
  const payload = base64url({
    sub: email,
    iss: INTERNAL_TOKEN_ISSUER,
    aud: AUDIENCE,
    iat,
    exp: iat + LIFETIME_SECONDS,
  });
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

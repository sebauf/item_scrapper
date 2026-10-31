import { createHmac } from 'node:crypto';

/**
 * Jeton interne MCP → backend : « cette requête est faite au nom de
 * `MCP_USER_EMAIL` ».
 *
 * L'agent externe n'a pas de session Google : le serveur MCP agit pour **un**
 * utilisateur fixé par configuration, et ses outils (mots-clés, favoris, URLs
 * suivies) lisent et modifient les données de ce seul compte. Même contrat que
 * le frontend (backend/src/shared/infrastructure/auth/internal-token.ts) :
 * HS256, secret partagé `BACKEND_AUTH_SECRET`, 60 s de validité, refait à
 * chaque appel.
 */
export const INTERNAL_TOKEN_ISSUER = 'price-tracker-mcp';

export function signInternalToken(email: string, secret: string, now: Date = new Date()): string {
  const iat = Math.floor(now.getTime() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    sub: email,
    iss: INTERNAL_TOKEN_ISSUER,
    aud: 'price-tracker-backend',
    iat,
    exp: iat + 60,
  });
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

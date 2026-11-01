import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { FRONTEND_DIR } from './stack.mjs';

/**
 * Outils d'un attaquant : fabriquer des jetons et des cookies, appeler une
 * Server Action en HTTP brut. Rien ici ne passe par l'interface.
 */

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

/**
 * Jeton interne arbitraire. Par défaut : valide pour le frontend. Chaque
 * champ peut être faussé pour un scénario (secret, émetteur, algorithme…).
 */
export function internalToken({
  sub,
  secret,
  iss = 'price-tracker-frontend',
  alg = 'HS256',
  aud = 'price-tracker-backend',
  iat = Math.floor(Date.now() / 1000),
  ttl = 60,
}) {
  const header = b64({ alg, typ: 'JWT' });
  const payload = b64({ sub, iss, aud, iat, exp: iat + ttl });
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

/**
 * Cookie de session Auth.js, chiffré exactement comme le ferait le frontend
 * après un retour de Google — avec la version d'Auth.js installée dans
 * frontend/, pour ne pas dériver de son format.
 */
const requireFromFrontend = createRequire(join(FRONTEND_DIR, 'package.json'));
let encodeJwt;
export async function sessionCookie(email, secret, cookieName = 'authjs.session-token') {
  encodeJwt ??= (await import(requireFromFrontend.resolve('next-auth/jwt'))).encode;
  const value = await encodeJwt({
    token: { email, name: email.split('@')[0], sub: `google-${email}` },
    secret,
    salt: cookieName,
  });
  return `${cookieName}=${value}`;
}

/** Altère un caractère au milieu du cookie, en restant dans l'alphabet base64url. */
export function tamper(cookie) {
  const [name, value] = cookie.split(/=(.*)/s);
  const i = Math.floor(value.length / 2);
  const flipped = value[i] === 'A' ? 'B' : 'A';
  return `${name}=${value.slice(0, i)}${flipped}${value.slice(i + 1)}`;
}

/**
 * Identifiants des Server Actions, extraits comme le ferait un attaquant :
 * du JavaScript **public** envoyé au navigateur, où Next 15 référence chaque
 * action par `createServerReference("<id>", …, "<nom exporté>")`.
 */
export function serverActionIds() {
  const ids = {};
  const pattern = /createServerReference\)\("([0-9a-f]+)",[^)]*?"(\w+)"\)/g;
  for (const file of walk(join(FRONTEND_DIR, '.next', 'static'))) {
    if (!file.endsWith('.js')) continue;
    for (const [, id, name] of readFileSync(file, 'utf8').matchAll(pattern)) ids[name] = id;
  }
  return ids;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

/**
 * Appelle une Server Action en HTTP brut : c'est un POST sur une page, avec
 * l'en-tête `Next-Action` et les arguments sérialisés en JSON. Aucune
 * interface, aucun formulaire — exactement ce qu'enverrait un script.
 *
 * `page` doit être une page dont le bundle serveur contient l'action (celle
 * qui affiche le composant qui l'utilise).
 */
export function callServerAction(baseUrl, { page, actionId, args, cookie, origin = baseUrl }) {
  const headers = {
    'Next-Action': actionId,
    'Content-Type': 'text/plain;charset=UTF-8',
    Accept: 'text/x-component',
    Origin: origin,
  };
  if (cookie) headers.Cookie = cookie;
  return fetch(baseUrl + page, {
    method: 'POST',
    headers,
    body: JSON.stringify(args),
    redirect: 'manual',
  });
}

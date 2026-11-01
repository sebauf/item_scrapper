#!/usr/bin/env node
/**
 * Fabrique un jeton interne pour appeler l'API à la main (curl, Swagger UI) en
 * développement, au nom d'une adresse donnée :
 *
 *     npm run token -- moi@gmail.com
 *     curl -H "Authorization: Bearer $(npm run -s token -- moi@gmail.com)" localhost:3001/api/v1/keywords
 *
 * Lit BACKEND_AUTH_SECRET dans l'environnement ou dans .env. Jeton valable
 * 15 minutes (le maximum que le backend accepte). Même contrat que
 * src/shared/infrastructure/auth/internal-token.ts ; signé comme le frontend
 * (même émetteur, même secret), seul émetteur autorisé pour tout compte.
 */
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

function secretFromDotEnv() {
  if (!existsSync('.env')) return undefined;
  const line = readFileSync('.env', 'utf8')
    .split('\n')
    .find((l) => l.startsWith('BACKEND_AUTH_SECRET='));
  return line?.slice('BACKEND_AUTH_SECRET='.length).trim();
}

const email = process.argv[2];
const secret = process.env.BACKEND_AUTH_SECRET ?? secretFromDotEnv();
if (!email || !secret) {
  console.error('Usage : npm run token -- <email>   (BACKEND_AUTH_SECRET requis, env ou .env)');
  process.exit(1);
}

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const iat = Math.floor(Date.now() / 1000);
const header = b64({ alg: 'HS256', typ: 'JWT' });
const payload = b64({ sub: email, iss: 'price-tracker-frontend', aud: 'price-tracker-backend', iat, exp: iat + 900 });
const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
process.stdout.write(`${header}.${payload}.${signature}\n`);

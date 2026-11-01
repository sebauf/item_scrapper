import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import { signInternalToken } from './internal-token.js';

/**
 * Le contrat est celui du backend (HS256, aud, 60 s) : un écart ici donnerait
 * des 401 sur chaque outil, sans que rien d'autre ne le signale.
 */
describe('signInternalToken', () => {
  const secret = 's'.repeat(40);
  const now = new Date('2026-10-31T12:00:00.000Z');

  it('signe en HS256 un jeton de 60 s au nom du compte, pour le backend', () => {
    const [header, payload, signature] = signInternalToken('moi@gmail.com', secret, now).split('.');

    assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), {
      alg: 'HS256',
      typ: 'JWT',
    });
    assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url').toString()), {
      sub: 'moi@gmail.com',
      iss: 'price-tracker-mcp',
      aud: 'price-tracker-backend',
      iat: now.getTime() / 1000,
      exp: now.getTime() / 1000 + 60,
    });
    assert.equal(
      signature,
      createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url'),
    );
  });
});

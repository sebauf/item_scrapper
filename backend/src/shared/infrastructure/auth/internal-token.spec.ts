import { createHmac } from 'node:crypto';
import {
  INTERNAL_TOKEN_AUDIENCE,
  InvalidInternalToken,
  signInternalToken,
  verifyInternalToken,
} from './internal-token';

const SECRET = 'a'.repeat(48);
const NOW = new Date('2026-10-31T12:00:00.000Z');
const nowSeconds = NOW.getTime() / 1000;

/** Fabrique un jeton arbitraire, signé ou non, pour les cas que `signInternalToken` refuse de produire. */
function craft(header: object, payload: object, secret = SECRET): string {
  const h = Buffer.from(JSON.stringify(header)).toString('base64url');
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const s = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}

const validPayload = {
  sub: 'alice@example.com',
  iss: 'price-tracker-frontend',
  aud: INTERNAL_TOKEN_AUDIENCE,
  iat: nowSeconds,
  exp: nowSeconds + 60,
};

describe('jeton interne', () => {
  it('fait l’aller-retour signature → vérification', () => {
    const token = signInternalToken({ sub: 'Alice@Example.com', iss: 'test' }, SECRET, NOW);

    const identity = verifyInternalToken(token, SECRET, NOW);

    expect(identity.userId.value).toBe('alice@example.com');
    expect(identity.issuer).toBe('test');
  });

  it('accepte un jeton fabriqué à la main selon le même contrat (frontend, MCP)', () => {
    const token = craft({ alg: 'HS256', typ: 'JWT' }, validPayload);

    expect(verifyInternalToken(token, SECRET, NOW).userId.value).toBe('alice@example.com');
  });

  describe('refus', () => {
    function expectRejected(token: string, reason: RegExp, now = NOW): void {
      expect(() => verifyInternalToken(token, SECRET, now)).toThrow(InvalidInternalToken);
      expect(() => verifyInternalToken(token, SECRET, now)).toThrow(reason);
    }

    it('un jeton mal formé', () => {
      expectRejected('abc.def', /format/);
    });

    it('un jeton signé avec un autre secret', () => {
      expectRejected(craft({ alg: 'HS256', typ: 'JWT' }, validPayload, 'b'.repeat(48)), /signature/);
    });

    it('un contenu modifié après signature (changement d’utilisateur)', () => {
      const [h, , s] = craft({ alg: 'HS256', typ: 'JWT' }, validPayload).split('.');
      const p = Buffer.from(JSON.stringify({ ...validPayload, sub: 'bob@example.com' })).toString(
        'base64url',
      );
      expectRejected(`${h}.${p}.${s}`, /signature/);
    });

    it('l’algorithme « none », même accompagné d’une signature valide', () => {
      expectRejected(craft({ alg: 'none', typ: 'JWT' }, validPayload), /algorithme/);
    });

    it('un autre algorithme HMAC', () => {
      expectRejected(craft({ alg: 'HS512', typ: 'JWT' }, validPayload), /algorithme/);
    });

    it('un jeton destiné à un autre service', () => {
      expectRejected(craft({ alg: 'HS256' }, { ...validPayload, aud: 'autre' }), /audience/);
    });

    it('un jeton expiré, au-delà de la tolérance d’horloge', () => {
      expectRejected(
        craft({ alg: 'HS256' }, { ...validPayload, iat: nowSeconds - 200, exp: nowSeconds - 31 }),
        /expiré/,
      );
    });

    it('un jeton émis dans le futur', () => {
      expectRejected(
        craft({ alg: 'HS256' }, { ...validPayload, iat: nowSeconds + 120, exp: nowSeconds + 180 }),
        /futur/,
      );
    });

    it('un jeton à durée de vie excessive', () => {
      expectRejected(
        craft({ alg: 'HS256' }, { ...validPayload, exp: nowSeconds + 24 * 3600 }),
        /durée de vie/,
      );
    });

    it('un jeton sans dates', () => {
      const { exp: _exp, ...withoutExp } = validPayload;
      expectRejected(craft({ alg: 'HS256' }, withoutExp), /dates/);
    });

    it('un sujet qui n’est pas une adresse', () => {
      expectRejected(craft({ alg: 'HS256' }, { ...validPayload, sub: 'admin' }), /sujet/);
    });
  });

  it('tolère un léger décalage d’horloge entre Pods', () => {
    const token = craft(
      { alg: 'HS256' },
      { ...validPayload, iat: nowSeconds - 80, exp: nowSeconds - 20 },
    );

    expect(() => verifyInternalToken(token, SECRET, NOW)).not.toThrow();
  });
});

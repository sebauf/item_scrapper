import { createHmac } from 'node:crypto';
import { UserId } from 'src/shared/domain/user-id';
import {
  FRONTEND_ISSUER,
  INTERNAL_TOKEN_AUDIENCE,
  InvalidInternalToken,
  MCP_ISSUER,
  signInternalToken,
  TokenIssuer,
  verifyInternalToken,
} from './internal-token';

const SECRET = 'a'.repeat(48);
const MCP_SECRET = 'm'.repeat(48);
const ISSUERS: TokenIssuer[] = [
  { issuer: FRONTEND_ISSUER, secret: SECRET },
  { issuer: MCP_ISSUER, secret: MCP_SECRET, onlySubject: UserId.create('agent@example.com') },
];
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
  iss: FRONTEND_ISSUER,
  aud: INTERNAL_TOKEN_AUDIENCE,
  iat: nowSeconds,
  exp: nowSeconds + 60,
};

describe('jeton interne', () => {
  it('fait l’aller-retour signature → vérification', () => {
    const token = signInternalToken({ sub: 'Alice@Example.com', iss: FRONTEND_ISSUER }, SECRET, NOW);

    const identity = verifyInternalToken(token, ISSUERS, NOW);

    expect(identity.userId.value).toBe('alice@example.com');
    expect(identity.issuer).toBe(FRONTEND_ISSUER);
  });

  it('accepte un jeton fabriqué à la main selon le même contrat (frontend, MCP)', () => {
    const token = craft({ alg: 'HS256', typ: 'JWT' }, validPayload);

    expect(verifyInternalToken(token, ISSUERS, NOW).userId.value).toBe('alice@example.com');
  });

  describe('refus', () => {
    function expectRejected(token: string, reason: RegExp, now = NOW): void {
      expect(() => verifyInternalToken(token, ISSUERS, now)).toThrow(InvalidInternalToken);
      expect(() => verifyInternalToken(token, ISSUERS, now)).toThrow(reason);
    }

    it('un émetteur inconnu', () => {
      expectRejected(craft({ alg: 'HS256' }, { ...validPayload, iss: 'pirate' }), /émetteur inconnu/);
    });

    it('un jeton sans émetteur', () => {
      const { iss: _iss, ...withoutIss } = validPayload;
      expectRejected(craft({ alg: 'HS256' }, withoutIss), /émetteur inconnu/);
    });

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

    expect(() => verifyInternalToken(token, ISSUERS, NOW)).not.toThrow();
  });

  /**
   * Le cloisonnement qui justifie deux secrets : celui du MCP ne doit ouvrir
   * que le compte du MCP, et ne doit pas pouvoir se faire passer pour le
   * frontend.
   */
  describe('émetteur restreint (MCP)', () => {
    const mcpPayload = { ...validPayload, iss: MCP_ISSUER, sub: 'agent@example.com' };

    it('accepte le MCP pour son propre compte', () => {
      const token = craft({ alg: 'HS256', typ: 'JWT' }, mcpPayload, MCP_SECRET);

      expect(verifyInternalToken(token, ISSUERS, NOW)).toMatchObject({ issuer: MCP_ISSUER });
    });

    it('refuse le MCP au nom d’un autre compte, même bien signé', () => {
      const token = craft({ alg: 'HS256' }, { ...mcpPayload, sub: 'alice@example.com' }, MCP_SECRET);

      expect(() => verifyInternalToken(token, ISSUERS, NOW)).toThrow(/non autorisé/);
    });

    it('refuse le secret du MCP présenté comme jeton du frontend', () => {
      const token = craft({ alg: 'HS256' }, { ...validPayload, iss: FRONTEND_ISSUER }, MCP_SECRET);

      expect(() => verifyInternalToken(token, ISSUERS, NOW)).toThrow(/signature/);
    });

    it('refuse tout jeton du MCP quand le MCP n’est pas configuré', () => {
      const token = craft({ alg: 'HS256' }, mcpPayload, MCP_SECRET);

      expect(() =>
        verifyInternalToken(token, [{ issuer: FRONTEND_ISSUER, secret: SECRET }], NOW),
      ).toThrow(/émetteur inconnu/);
    });
  });
});

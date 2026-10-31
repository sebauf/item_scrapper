import { vi } from 'vitest';

/**
 * Double de `@/auth` (Auth.js), installé pour toute la suite par
 * vitest.setup.ts : aucun test ne doit dépendre d'un vrai fournisseur OAuth.
 *
 * Par défaut, Alice est connectée. Un test qui veut un visiteur anonyme
 * appelle `authMock.auth.mockResolvedValueOnce(null)`.
 */
export const TEST_SESSION = {
  user: { email: 'alice@example.com', name: 'Alice Martin', image: null },
  expires: '2099-01-01T00:00:00.000Z',
};

export const authMock = {
  auth: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  /** Liste blanche : tout le monde est autorisé, sauf mention contraire du test. */
  hasAccess: vi.fn(),
  handlers: { GET: vi.fn(), POST: vi.fn() },
  __reset(): void {
    authMock.auth.mockReset().mockResolvedValue(TEST_SESSION);
    authMock.signIn.mockReset();
    authMock.signOut.mockReset();
    authMock.hasAccess.mockReset().mockReturnValue(true);
  },
};

authMock.__reset();

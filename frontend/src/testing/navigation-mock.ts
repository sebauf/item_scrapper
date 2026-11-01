import { vi } from 'vitest';

/**
 * Double de `next/navigation`.
 *
 * Les composants clients naviguent en appelant `router.replace`/`push` : les
 * tests vérifient donc l'URL demandée, ce qui est exactement ce qui finit dans
 * la barre d'adresse et dans la requête serveur suivante.
 */
const router = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
};

let pathname = '/';

/**
 * Le vrai `redirect` interrompt le rendu en levant une erreur spéciale
 * (NEXT_REDIRECT) ; le double fait de même, pour que le code qui suit un
 * `redirect` ne s'exécute pas non plus en test.
 */
export class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`NEXT_REDIRECT ${url}`);
    this.name = 'RedirectSignal';
  }
}

export const navigationMock = {
  useRouter: () => router,
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn((url: string): never => {
    throw new RedirectSignal(url);
  }),
  /** Positionne le chemin courant vu par `usePathname`. */
  __setPathname(next: string) {
    pathname = next;
  },
  __router: router,
  __reset() {
    pathname = '/';
    router.push.mockClear();
    router.replace.mockClear();
    router.refresh.mockClear();
    router.back.mockClear();
    router.forward.mockClear();
    router.prefetch.mockClear();
  },
};

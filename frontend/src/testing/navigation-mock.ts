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

export const navigationMock = {
  useRouter: () => router,
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
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

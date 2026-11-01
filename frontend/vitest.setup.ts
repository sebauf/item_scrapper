import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import React from 'react';
import { authMock } from './src/testing/auth-mock';
import { navigationMock } from './src/testing/navigation-mock';

/**
 * Les modules de Next.js qui supposent un serveur Next en marche sont
 * remplacés ici, une fois pour toutes.
 *
 * `next/link` et `next/image` ont besoin du contexte de l'App Router et du
 * loader d'images ; les remplacer par leurs équivalents HTML garde les tests
 * centrés sur *notre* code (le `href` calculé, l'`alt` transmis) plutôt que
 * sur le comportement interne du framework.
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}));

vi.mock('next/image', () => ({
  default: ({ src, alt, ...rest }: { src: string; alt: string } & Record<string, unknown>) => {
    // `fill`, `sizes` et `priority` sont propres à next/image : les laisser
    // passer sur un <img> ne ferait que polluer la sortie avec des warnings React.
    const { fill: _fill, sizes: _sizes, priority: _priority, ...imgProps } = rest;
    return React.createElement('img', { src, alt, ...imgProps });
  },
}));

vi.mock('next/navigation', () => navigationMock);

// Auth.js suppose un serveur Next et un fournisseur OAuth : remplacé par une
// session factice (Alice connectée), cf. src/testing/auth-mock.ts.
vi.mock('@/auth', () => authMock);

// En beforeEach, pas en afterEach : `restoreMocks` (vitest.config.ts) efface les
// implémentations des vi.fn() avant chaque test, session par défaut comprise.
beforeEach(() => {
  authMock.__reset();
});

afterEach(() => {
  cleanup();
  navigationMock.__reset();
});

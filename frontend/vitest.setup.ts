import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import React from 'react';
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

afterEach(() => {
  cleanup();
  navigationMock.__reset();
});

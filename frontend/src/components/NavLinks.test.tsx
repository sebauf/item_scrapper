import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { navigationMock } from '@/testing/navigation-mock';
import { NavLinks } from './NavLinks';

/**
 * L'onglet actif est calculé à partir du chemin courant, avec une règle qui
 * n'a rien d'évident : une fiche produit reste rattachée à « Mots-clés »,
 * parce qu'on y arrive depuis les résultats d'un mot-clé.
 *
 * Chaque lien est rendu deux fois (barre desktop + barre mobile), d'où les
 * `getAllBy*`.
 */
function activeLabels(): string[] {
  return screen
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page')
    .map((link) => link.textContent?.trim() ?? '');
}

function renderAt(pathname: string) {
  navigationMock.__setPathname(pathname);
  return render(<NavLinks />);
}

describe('NavLinks', () => {
  it('rend les quatre entrées, en desktop et en mobile', () => {
    renderAt('/');

    expect(screen.getAllByRole('link')).toHaveLength(8);
    expect(screen.getAllByText('Dashboard')).toHaveLength(2);
  });

  it.each([
    ['/', 'Dashboard'],
    ['/keywords', 'Mots-clés'],
    ['/products', 'Suivi'],
    ['/favorites', 'Favoris'],
  ])('marque %s comme actif', (pathname, label) => {
    renderAt(pathname);

    expect(new Set(activeLabels())).toEqual(new Set([label]));
  });

  it('rattache une page de mot-clé et une fiche produit à « Mots-clés »', () => {
    renderAt('/keyword/lessive');
    expect(new Set(activeLabels())).toEqual(new Set(['Mots-clés']));

    renderAt('/product/aWQ');
    expect(activeLabels().every((label) => label === 'Mots-clés')).toBe(true);
  });

  it('n’active le dashboard que sur la racine exacte', () => {
    // Sans cette exception, « / » serait préfixe de toutes les routes et
    // resterait allumé en permanence.
    renderAt('/keywords');

    expect(activeLabels()).not.toContain('Dashboard');
  });

  it('n’active rien sur une route inconnue', () => {
    renderAt('/404-inconnu');

    expect(activeLabels()).toEqual([]);
  });
});

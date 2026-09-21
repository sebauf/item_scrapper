import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { parseProductListParams, type ProductListParams } from '@/lib/search-params';
import { navigationMock } from '@/testing/navigation-mock';
import { ProductFilters } from './ProductFilters';

/**
 * Barre de filtres : elle ne filtre rien elle-même, elle réécrit l'URL — c'est
 * le serveur qui refait la requête. Les tests portent donc sur l'URL produite.
 *
 * Deux comportements méritent d'être figés : la saisie texte est temporisée
 * (une navigation par caractère serait insupportable), et elle remplace
 * l'entrée d'historique au lieu d'en empiler une par frappe, alors qu'un
 * changement de tri, lui, s'empile.
 */
function params(overrides: Partial<ProductListParams> = {}): ProductListParams {
  return { ...parseProductListParams({}), ...overrides };
}

function renderFilters(overrides: Partial<ProductListParams> = {}, dealCount = 3) {
  navigationMock.__setPathname('/keyword/lessive');
  return render(<ProductFilters params={params(overrides)} dealCount={dealCount} />);
}

describe('ProductFilters', () => {
  it('affiche les valeurs courantes', () => {
    renderFilters({ q: 'savon', sort: 'price_asc', min: 5, max: 50 });

    expect(screen.getByRole('searchbox')).toHaveValue('savon');
    expect(screen.getByRole('combobox')).toHaveValue('price_asc');
    expect(screen.getByPlaceholderText('Min €')).toHaveValue(5);
    expect(screen.getByPlaceholderText('Max €')).toHaveValue(50);
  });

  it('ouvre d’emblée les filtres de prix s’ils sont actifs', () => {
    renderFilters({ min: 5 });

    expect(screen.getByPlaceholderText('Min €')).toBeInTheDocument();
  });

  it('garde les filtres de prix repliés par défaut', () => {
    renderFilters();

    expect(screen.queryByPlaceholderText('Min €')).not.toBeInTheDocument();
  });

  describe('recherche', () => {
    it('navigue après la temporisation, pas à chaque frappe', async () => {
      const user = userEvent.setup();
      renderFilters();

      await user.type(screen.getByRole('searchbox'), 'savon');

      expect(navigationMock.__router.replace).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(navigationMock.__router.replace).toHaveBeenCalledWith('/keyword/lessive?q=savon', {
          scroll: false,
        }),
      );
      // Une seule navigation pour cinq caractères.
      expect(navigationMock.__router.replace).toHaveBeenCalledTimes(1);
    });

    it('remplace l’entrée d’historique plutôt que d’en empiler une', async () => {
      const user = userEvent.setup();
      renderFilters();

      await user.type(screen.getByRole('searchbox'), 'savon');

      await waitFor(() => expect(navigationMock.__router.replace).toHaveBeenCalled());
      expect(navigationMock.__router.push).not.toHaveBeenCalled();
    });

    it('repart de la première page', async () => {
      const user = userEvent.setup();
      renderFilters({ page: 4 });

      await user.type(screen.getByRole('searchbox'), 'savon');

      await waitFor(() =>
        expect(navigationMock.__router.replace).toHaveBeenCalledWith(
          '/keyword/lessive?q=savon',
          expect.anything(),
        ),
      );
    });
  });

  describe('tri', () => {
    it('navigue immédiatement et empile l’historique', async () => {
      const user = userEvent.setup();
      renderFilters();

      await user.selectOptions(screen.getByRole('combobox'), 'price_desc');

      // `push` et non `replace` : revenir en arrière doit rendre le tri précédent.
      expect(navigationMock.__router.push).toHaveBeenCalledWith(
        '/keyword/lessive?sort=price_desc',
        { scroll: false },
      );
    });
  });

  describe('bonnes affaires', () => {
    it('affiche le compteur et bascule le filtre', async () => {
      const user = userEvent.setup();
      renderFilters({}, 7);

      await user.click(screen.getByRole('button', { name: /7/ }));

      expect(navigationMock.__router.replace).toHaveBeenCalledWith('/keyword/lessive?deals=1', {
        scroll: false,
      });
    });

    it('retire le filtre quand il est déjà actif', async () => {
      const user = userEvent.setup();
      renderFilters({ deals: true }, 7);

      await user.click(screen.getByRole('button', { name: /7/ }));

      expect(navigationMock.__router.replace).toHaveBeenCalledWith('/keyword/lessive', {
        scroll: false,
      });
    });

    it('cache le bouton quand il n’y a aucune affaire', () => {
      renderFilters({}, 0);

      // `queryByRole` et pas un texte : « Meilleures affaires » existe aussi
      // dans la liste de tri, qui ne doit pas être confondue avec le filtre.
      expect(screen.queryByRole('button', { name: /affaire/ })).not.toBeInTheDocument();
    });

    it('accorde le pluriel', () => {
      const { unmount } = renderFilters({}, 1);
      expect(screen.getByRole('button', { name: /1 affaire$/ })).toBeInTheDocument();
      unmount();

      renderFilters({}, 2);
      expect(screen.getByRole('button', { name: /2 affaires$/ })).toBeInTheDocument();
    });
  });

  describe('bornes de prix', () => {
    it('navigue avec les deux bornes', async () => {
      const user = userEvent.setup();
      renderFilters({ min: 5 });

      await user.type(screen.getByPlaceholderText('Max €'), '50');

      await waitFor(() =>
        expect(navigationMock.__router.replace).toHaveBeenCalledWith(
          '/keyword/lessive?min=5&max=50',
          expect.anything(),
        ),
      );
    });

    it('efface les deux bornes d’un coup', async () => {
      const user = userEvent.setup();
      renderFilters({ min: 5, max: 50 });

      await user.click(screen.getByRole('button', { name: 'Effacer' }));

      expect(screen.getByPlaceholderText('Min €')).toHaveValue(null);
      await waitFor(() =>
        expect(navigationMock.__router.replace).toHaveBeenCalledWith(
          '/keyword/lessive',
          expect.anything(),
        ),
      );
    });
  });

  it('adopte une URL changée de l’extérieur (retour arrière, lien de reset)', async () => {
    const { rerender } = renderFilters({ q: 'savon' });
    expect(screen.getByRole('searchbox')).toHaveValue('savon');

    rerender(<ProductFilters params={params({ q: '' })} dealCount={3} />);

    await waitFor(() => expect(screen.getByRole('searchbox')).toHaveValue(''));
  });
});

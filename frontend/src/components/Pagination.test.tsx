import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { parseProductListParams, type ProductListParams } from '@/lib/search-params';
import { Pagination } from './Pagination';

/**
 * La fenêtre de pagination doit rester lisible quel que soit le nombre de
 * pages, et chaque lien doit conserver les filtres en cours — sinon changer de
 * page réinitialise la recherche, ce que personne n'attend.
 */
function params(overrides: Partial<ProductListParams> = {}): ProductListParams {
  return { ...parseProductListParams({}), ...overrides };
}

function pageLinks(): string[] {
  return screen
    .getAllByRole('link')
    .map((link) => link.textContent?.trim() ?? '')
    .filter((label) => /^\d+$/.test(label));
}

describe('Pagination', () => {
  it('ne s’affiche pas quand il n’y a qu’une page', () => {
    const { container } = render(
      <Pagination basePath="/keyword/lessive" params={params()} pageCount={1} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('liste toutes les pages quand elles tiennent', () => {
    render(<Pagination basePath="/keyword/lessive" params={params({ page: 2 })} pageCount={3} />);

    expect(pageLinks()).toEqual(['1', '2', '3']);
    expect(screen.queryByText('…')).not.toBeInTheDocument();
  });

  it('resserre la fenêtre autour de la page courante', () => {
    render(<Pagination basePath="/keyword/lessive" params={params({ page: 10 })} pageCount={20} />);

    // Première, voisines, dernière — le reste est élidé.
    expect(pageLinks()).toEqual(['1', '9', '10', '11', '20']);
    expect(screen.getAllByText('…')).toHaveLength(2);
  });

  it('n’élide pas du côté où il n’y a rien à cacher', () => {
    render(<Pagination basePath="/keyword/lessive" params={params({ page: 2 })} pageCount={20} />);

    expect(pageLinks()).toEqual(['1', '2', '3', '20']);
    expect(screen.getAllByText('…')).toHaveLength(1);
  });

  it('marque la page courante pour les lecteurs d’écran', () => {
    render(<Pagination basePath="/keyword/lessive" params={params({ page: 2 })} pageCount={3} />);

    expect(screen.getByText('2').closest('a')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('1').closest('a')).not.toHaveAttribute('aria-current');
  });

  it('conserve les filtres dans chaque lien', () => {
    render(
      <Pagination
        basePath="/keyword/lessive"
        params={params({ q: 'savon', deals: true, sort: 'price_asc', page: 1 })}
        pageCount={3}
      />,
    );

    expect(screen.getByText('2').closest('a')).toHaveAttribute(
      'href',
      '/keyword/lessive?q=savon&deals=1&sort=price_asc&page=2',
    );
  });

  it('omet le numéro de page sur la première — l’URL canonique reste propre', () => {
    render(<Pagination basePath="/keyword/lessive" params={params({ page: 2 })} pageCount={3} />);

    expect(screen.getByText('1').closest('a')).toHaveAttribute('href', '/keyword/lessive');
  });

  describe('précédent / suivant', () => {
    it('sont des liens au milieu de la liste', () => {
      render(<Pagination basePath="/keyword/lessive" params={params({ page: 2 })} pageCount={3} />);

      const previous = screen.getByText('Précédent').closest('a');
      const next = screen.getByText('Suivant').closest('a');

      expect(previous).toHaveAttribute('href', '/keyword/lessive');
      expect(previous).toHaveAttribute('rel', 'prev');
      expect(next).toHaveAttribute('href', '/keyword/lessive?page=3');
      expect(next).toHaveAttribute('rel', 'next');
    });

    it('ne sont plus cliquables aux extrémités', () => {
      const { rerender } = render(
        <Pagination basePath="/keyword/lessive" params={params({ page: 1 })} pageCount={3} />,
      );
      expect(screen.getByText('Précédent').closest('a')).toBeNull();

      rerender(<Pagination basePath="/keyword/lessive" params={params({ page: 3 })} pageCount={3} />);
      expect(screen.getByText('Suivant').closest('a')).toBeNull();
    });
  });
});

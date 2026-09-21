import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { aProduct } from '@/testing/fixtures';
import { ProductCard, TrendBadge } from './ProductCard';

/**
 * La carte produit n'a aucune règle métier : le verdict « bonne affaire » lui
 * arrive déjà calculé du backend. Ce qu'elle doit garantir, c'est de ne rien
 * inventer — pas de remise affichée sans prix barré, pas de badge sans score.
 */
describe('ProductCard', () => {
  it('affiche le titre, le prix et un lien vers la fiche', () => {
    render(<ProductCard product={aProduct()} />);

    expect(screen.getByText('Lessive liquide 3L')).toBeInTheDocument();
    expect(screen.getByText(/12,99/)).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/product/aHR0cHM6Ly93d3cuYW1hem9uLmZyL2RwL0IwVEVTVDAwMDE',
    );
  });

  it('affiche la première image avec le titre en texte alternatif', () => {
    render(<ProductCard product={aProduct()} />);

    expect(screen.getByRole('img')).toHaveAttribute('alt', 'Lessive liquide 3L');
  });

  it('remplace une image manquante par un visuel neutre', () => {
    render(<ProductCard product={aProduct({ images: [] })} />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  describe('prix barré', () => {
    it('affiche la remise calculée', () => {
      render(
        <ProductCard
          product={aProduct({
            price: { amount: 15, currency: 'EUR' },
            crossedOutPrice: { amount: 20, currency: 'EUR' },
          })}
        />,
      );

      expect(screen.getByText('−25%')).toBeInTheDocument();
    });

    it('n’affiche rien sans prix courant', () => {
      // Une remise sans prix de référence ne veut rien dire.
      render(
        <ProductCard
          product={aProduct({ price: null, crossedOutPrice: { amount: 20, currency: 'EUR' } })}
        />,
      );

      expect(screen.queryByText(/−\d+%/)).not.toBeInTheDocument();
    });
  });

  describe('bonne affaire', () => {
    it('affiche le badge quand le backend l’a décidé', () => {
      render(<ProductCard product={aProduct({ isDeal: true, dealScore: 32.4 })} />);

      expect(screen.getByText('🔥 −32%')).toBeInTheDocument();
    });

    it('n’affiche pas de badge pour un produit ordinaire', () => {
      render(<ProductCard product={aProduct({ isDeal: false, dealScore: 5 })} />);

      expect(screen.queryByText(/🔥/)).not.toBeInTheDocument();
    });

    it('n’affiche pas de badge si le score est absent', () => {
      render(<ProductCard product={aProduct({ isDeal: true, dealScore: null })} />);

      expect(screen.queryByText(/🔥/)).not.toBeInTheDocument();
    });
  });

  describe('champs optionnels', () => {
    it('affiche le prix à l’unité, la livraison et le prix attendu', () => {
      render(
        <ProductCard
          product={aProduct({
            unitPrice: { amount: 4.33, unit: 'L' },
            deliveryDate: 'Livraison lundi 11 août',
            predictedPrice: 19.99,
          })}
        />,
      );

      expect(screen.getByText(/4,33.*\/L/)).toBeInTheDocument();
      expect(screen.getByText(/Livraison lundi 11 août/)).toBeInTheDocument();
      expect(screen.getByText(/19,99/)).toBeInTheDocument();
    });

    it('omet ce qui vaut null plutôt que d’afficher un libellé vide', () => {
      render(<ProductCard product={aProduct()} />);

      expect(screen.queryByText(/Prix attendu/)).not.toBeInTheDocument();
      expect(screen.queryByText(/📦/)).not.toBeInTheDocument();
    });

    it('affiche le prix attendu même à zéro', () => {
      // `predictedPrice !== null` et non une simple vérité : 0 est une valeur.
      render(<ProductCard product={aProduct({ predictedPrice: 0 })} />);

      expect(screen.getByText(/Prix attendu/)).toBeInTheDocument();
    });
  });

  describe('tendance', () => {
    it.each([
      ['down', '↓ Baisse'],
      ['up', '↑ Hausse'],
    ] as const)('affiche la tendance %s', (trendDirection, label) => {
      render(<ProductCard product={aProduct({ trendDirection })} />);

      expect(screen.getByText(label)).toBeInTheDocument();
    });

    it('n’affiche rien pour une tendance stable ou absente', () => {
      const { rerender } = render(<ProductCard product={aProduct({ trendDirection: 'stable' })} />);
      expect(screen.queryByText(/Baisse|Hausse/)).not.toBeInTheDocument();

      rerender(<ProductCard product={aProduct({ trendDirection: null })} />);
      expect(screen.queryByText(/Baisse|Hausse/)).not.toBeInTheDocument();
    });
  });
});

describe('TrendBadge', () => {
  it('ne rend rien pour une tendance stable', () => {
    const { container } = render(<TrendBadge trend="stable" />);

    expect(container).toBeEmptyDOMElement();
  });
});

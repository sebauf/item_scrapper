import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductDetail } from '@/lib/api';
import { aProduct } from '@/testing/fixtures';

vi.mock('@/app/actions', () => ({ removeFavoriteAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./PriceChart', () => ({
  // Le graphe a ses propres tests ; ici seule compte la décision de l'afficher
  // ou non, et les points qu'on lui passe.
  PriceChart: ({ data, currency }: { data: unknown[]; currency: string }) => (
    <div data-testid="chart" data-points={data.length} data-currency={currency} />
  ),
}));

const actions = await import('@/app/actions');
const { FavoriteCard } = await import('./FavoriteCard');

function aFavorite(overrides: Partial<ProductDetail> = {}): ProductDetail {
  return {
    ...aProduct(),
    history: [],
    firstSeen: '2026-08-01T00:00:00.000Z',
    lastSeen: '2026-08-08T00:00:00.000Z',
    ...overrides,
  };
}

function history(prices: (number | null)[]) {
  return prices.map((amount, index) => ({
    day: `2026-08-0${index + 1}T00:00:00.000Z`,
    price: amount === null ? null : { amount, currency: 'EUR' },
    crossedOutPrice: null,
    unitPrice: null,
    scrapedAt: `2026-08-0${index + 1}T06:00:00.000Z`,
  }));
}

describe('FavoriteCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('affiche le produit et un lien vers sa fiche', () => {
    render(<FavoriteCard product={aFavorite()} />);

    expect(screen.getByText('Lessive liquide 3L').closest('a')).toHaveAttribute(
      'href',
      `/product/${aProduct().id}`,
    );
    expect(screen.getByText(/12,99/)).toBeInTheDocument();
  });

  it('retire des favoris sans demander confirmation', async () => {
    // Choix assumé : reperdre un favori est un clic, contrairement à la
    // suppression d'un mot-clé qui arrête un scrape.
    const user = userEvent.setup();
    render(<FavoriteCard product={aFavorite()} />);

    await user.click(screen.getByTitle('Retirer des favoris'));

    await waitFor(() => expect(actions.removeFavoriteAction).toHaveBeenCalledWith(aProduct().id));
  });

  describe('graphe', () => {
    it('s’affiche dès deux relevés chiffrés', () => {
      render(<FavoriteCard product={aFavorite({ history: history([14.99, 12.99]) })} />);

      expect(screen.getByTestId('chart')).toHaveAttribute('data-points', '2');
    });

    it('cède la place à un message en deçà', () => {
      render(<FavoriteCard product={aFavorite({ history: history([12.99]) })} />);

      expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
      expect(screen.getByText(/Historique insuffisant/)).toBeInTheDocument();
    });

    it('ne compte pas les jours sans prix', () => {
      render(<FavoriteCard product={aFavorite({ history: history([12.99, null, null]) })} />);

      expect(screen.getByText(/Historique insuffisant/)).toBeInTheDocument();
    });

    it('déduit la devise de l’historique quand le prix courant manque', () => {
      render(
        <FavoriteCard product={aFavorite({ price: null, history: history([14.99, 12.99]) })} />,
      );

      expect(screen.getByTestId('chart')).toHaveAttribute('data-currency', 'EUR');
    });
  });

  it('affiche la tendance, sauf si elle est stable', () => {
    const { unmount } = render(<FavoriteCard product={aFavorite({ trendDirection: 'down' })} />);
    expect(screen.getByText('↓ Baisse')).toBeInTheDocument();
    unmount();

    render(<FavoriteCard product={aFavorite({ trendDirection: 'stable' })} />);
    expect(screen.queryByText(/Baisse|Hausse/)).not.toBeInTheDocument();
  });

  it('affiche le prix barré quand il existe', () => {
    render(
      <FavoriteCard
        product={aFavorite({
          price: { amount: 12.99, currency: 'EUR' },
          crossedOutPrice: { amount: 19.99, currency: 'EUR' },
        })}
      />,
    );

    expect(screen.getByText(/19,99/)).toBeInTheDocument();
  });
});

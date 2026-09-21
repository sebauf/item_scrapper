import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import type { PricePoint } from './PriceChart';

/**
 * `ResponsiveContainer` mesure son parent : en jsdom il obtient 0×0 et ne rend
 * rien. On lui impose donc une taille, sinon le test ne prouverait que
 * l'absence de crash.
 */
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
      React.createElement(actual.ResponsiveContainer, { width: 640, height: 320, children }),
  };
});

const { PriceChart } = await import('./PriceChart');

const POINTS: PricePoint[] = [
  { day: '2026-08-05T00:00:00.000Z', price: 14.99, crossedOut: null },
  { day: '2026-08-06T00:00:00.000Z', price: 13.5, crossedOut: null },
  { day: '2026-08-07T00:00:00.000Z', price: 12.99, crossedOut: null },
];

describe('PriceChart', () => {
  it('trace une courbe', () => {
    const { container } = render(<PriceChart data={POINTS} currency="EUR" />);

    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(container.querySelectorAll('.recharts-line').length).toBeGreaterThan(0);
  });

  it('n’affiche la légende que s’il existe un prix barré', () => {
    const { unmount } = render(<PriceChart data={POINTS} currency="EUR" />);
    expect(screen.queryByText('Prix barré')).not.toBeInTheDocument();
    unmount();

    render(
      <PriceChart
        data={[...POINTS, { day: '2026-08-08T00:00:00.000Z', price: 12, crossedOut: 20 }]}
        currency="EUR"
      />,
    );
    expect(screen.getByText('Prix barré')).toBeInTheDocument();
  });

  it('trace une seconde courbe pour le prix barré', () => {
    const { container } = render(
      <PriceChart
        data={[...POINTS, { day: '2026-08-08T00:00:00.000Z', price: 12, crossedOut: 20 }]}
        currency="EUR"
      />,
    );

    expect(container.querySelectorAll('.recharts-line')).toHaveLength(2);
  });

  it('matérialise le prix attendu quand il est connu', () => {
    render(<PriceChart data={POINTS} predictedPrice={15} currency="EUR" />);

    expect(screen.getByText('Prix attendu')).toBeInTheDocument();
  });

  it('n’affiche pas de repère sans prix attendu', () => {
    render(<PriceChart data={POINTS} currency="EUR" />);

    expect(screen.queryByText('Prix attendu')).not.toBeInTheDocument();
  });

  it('formate les montants dans la devise du produit', () => {
    const { container } = render(<PriceChart data={POINTS} currency="USD" />);

    expect(container.textContent).toMatch(/\$|US/);
  });

  it('supporte un historique troué', () => {
    // Un jour sans prix (produit indisponible) ne doit pas interrompre le rendu.
    expect(() =>
      render(
        <PriceChart
          data={[POINTS[0], { day: '2026-08-06T00:00:00.000Z', price: null, crossedOut: null }, POINTS[2]]}
          currency="EUR"
        />,
      ),
    ).not.toThrow();
  });
});

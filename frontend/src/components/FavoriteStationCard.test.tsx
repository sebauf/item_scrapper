import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { aFavoriteFuel, aFavoriteStation } from '@/testing/fixtures';

vi.mock('@/app/actions', () => ({
  addFavoriteStationAction: vi.fn(),
  removeFavoriteStationAction: vi.fn(),
}));

const { FavoriteStationCard } = await import('./FavoriteStationCard');

const now = new Date('2026-11-05T12:00:00.000Z');
const likely = {
  risk: 0.62,
  level: 'likely' as const,
  computedAt: '2026-11-05T11:30:00.000Z',
  horizonEnd: '2026-11-06T11:30:00.000Z',
};

describe('FavoriteStationCard', () => {
  it('affiche prix et prévision de chaque carburant, dans l’ordre habituel', () => {
    render(
      <FavoriteStationCard
        now={now}
        favorite={aFavoriteStation({
          station: {
            fuels: [
              aFavoriteFuel({ code: 'e10', price: 1.799, shortageOutlook: { ...likely, risk: 0.05, level: 'low' } }),
              aFavoriteFuel({ code: 'gazole', price: 1.689, shortageOutlook: likely }),
            ],
          },
        })}
      />,
    );

    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => within(row).getByText(/Gazole|SP95-E10/).textContent)).toEqual([
      'Gazole',
      'SP95-E10',
    ]);
    expect(within(rows[0]).getByText(/1,689/)).toBeInTheDocument();
    expect(within(rows[0]).getByText('62 %')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Rupture probable avant demain à 12:30')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Pas de rupture attendue d’ici demain à 12:30')).toBeInTheDocument();
    // Le pire niveau de la station est rappelé en tête de carte.
    expect(screen.getByRole('heading', { name: /TotalEnergies/ })).toBeInTheDocument();
    expect(screen.getAllByText('Rupture probable')).toHaveLength(1);
  });

  it('un carburant en rupture n’a pas de prévision, mais sa rupture', () => {
    render(
      <FavoriteStationCard
        now={now}
        favorite={aFavoriteStation({
          station: {
            fuels: [
              aFavoriteFuel({ price: null, available: false, shortageSince: '2026-11-05T09:00:00.000Z' }),
            ],
          },
        })}
      />,
    );

    expect(screen.getByText('En rupture')).toBeInTheDocument();
    expect(screen.getByText(/Rupture déclarée il y a/)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('dit qu’il n’y a pas de prévision plutôt que d’afficher « faible »', () => {
    render(<FavoriteStationCard now={now} favorite={aFavoriteStation()} />);

    expect(screen.getByText('Pas de prévision')).toBeInTheDocument();
    expect(screen.queryByText(/Risque faible/)).not.toBeInTheDocument();
  });

  it('signale une favorite sortie du flux, et permet de la retirer', () => {
    render(<FavoriteStationCard now={now} favorite={aFavoriteStation({ id: '12345678', station: null })} />);

    expect(screen.getByText('Station n° 12345678')).toBeInTheDocument();
    expect(screen.getByText(/Absente du flux officiel/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retirer des stations favorites' })).toBeInTheDocument();
  });
});

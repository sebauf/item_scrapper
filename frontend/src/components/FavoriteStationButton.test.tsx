import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/actions', () => ({
  addFavoriteStationAction: vi.fn(),
  removeFavoriteStationAction: vi.fn(),
}));

const actions = await import('@/app/actions');
const { FavoriteStationButton } = await import('./FavoriteStationButton');

/**
 * Une étoile allumée promet que l'alerte surveille la station : le test qui
 * compte est l'annulation de la bascule optimiste quand l'appel échoue.
 */
describe('FavoriteStationButton', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ajoute la station au clic', async () => {
    render(<FavoriteStationButton stationId="69003001" initialFavorite={false} />);

    await userEvent.click(screen.getByRole('button'));

    expect(actions.addFavoriteStationAction).toHaveBeenCalledWith('69003001');
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('retire une station favorite', async () => {
    render(<FavoriteStationButton stationId="69003001" initialFavorite={true} />);

    await userEvent.click(screen.getByRole('button'));

    expect(actions.removeFavoriteStationAction).toHaveBeenCalledWith('69003001');
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');
  });

  it('annule la bascule si l’appel échoue', async () => {
    vi.mocked(actions.addFavoriteStationAction).mockRejectedValue(new Error('boom'));
    render(<FavoriteStationButton stationId="69003001" initialFavorite={false} />);

    await userEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false'));
  });
});

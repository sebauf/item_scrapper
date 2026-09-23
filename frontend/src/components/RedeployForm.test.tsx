import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/actions', () => ({ redeployAction: vi.fn() }));

const actions = await import('@/app/actions');
const { RedeployForm } = await import('./RedeployForm');

describe('RedeployForm', () => {
  beforeEach(() => vi.clearAllMocks());

  async function submit(token: string) {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Jeton administrateur'), token);
    await user.click(screen.getByRole('button'));
  }

  it('transmet le jeton saisi à la Server Action', async () => {
    vi.mocked(actions.redeployAction).mockResolvedValue({ restarted: ['price-tracker-backend'] });
    render(<RedeployForm updateAvailable={true} rolloutInProgress={false} />);

    await submit('mon-jeton');

    await waitFor(() => expect(actions.redeployAction).toHaveBeenCalled());
    expect(vi.mocked(actions.redeployAction).mock.calls[0][1].get('token')).toBe('mon-jeton');
  });

  it('masque le jeton à la saisie', () => {
    render(<RedeployForm updateAvailable={true} rolloutInProgress={false} />);

    expect(screen.getByLabelText('Jeton administrateur')).toHaveAttribute('type', 'password');
  });

  it('confirme les composants redémarrés', async () => {
    vi.mocked(actions.redeployAction).mockResolvedValue({
      restarted: ['price-tracker-frontend', 'price-tracker-backend'],
    });
    render(<RedeployForm updateAvailable={true} rolloutInProgress={false} />);

    await submit('mon-jeton');

    expect(await screen.findByRole('status')).toHaveTextContent(
      'price-tracker-frontend, price-tracker-backend',
    );
  });

  it('affiche le refus du backend', async () => {
    vi.mocked(actions.redeployAction).mockResolvedValue({ error: 'Jeton administrateur invalide.' });
    render(<RedeployForm updateAvailable={true} rolloutInProgress={false} />);

    await submit('mauvais');

    expect(await screen.findByRole('alert')).toHaveTextContent('Jeton administrateur invalide.');
  });

  it('se désactive pendant un rollout', () => {
    render(<RedeployForm updateAvailable={true} rolloutInProgress={true} />);

    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.getByRole('button')).toHaveTextContent('Mise à jour en cours');
  });

  it('reste disponible sans nouvelle version, sous un libellé explicite', () => {
    // Utile quand un état est « inconnu » (registre injoignable) : le backend
    // tranchera, et dira « déjà à jour » s'il n'y a vraiment rien à faire.
    render(<RedeployForm updateAvailable={false} rolloutInProgress={false} />);

    expect(screen.getByRole('button')).toBeEnabled();
    expect(screen.getByRole('button')).toHaveTextContent('Redéployer quand même');
  });
});

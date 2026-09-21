import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/actions', () => ({ addTrackedUrl: vi.fn().mockResolvedValue({ success: true }) }));

const actions = await import('@/app/actions');
const { AddTrackedUrlModal } = await import('./AddTrackedUrlModal');

/** Miroir de AddKeywordModal, pour le suivi d'une URL individuelle. */
describe('AddTrackedUrlModal', () => {
  const URL_VALIDE = 'https://www.amazon.fr/dp/B0TEST0001/';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(actions.addTrackedUrl).mockResolvedValue({ success: true });
  });

  it('soumet l’URL saisie', async () => {
    const user = userEvent.setup();
    render(<AddTrackedUrlModal onClose={vi.fn()} />);

    await user.type(screen.getByRole('textbox'), URL_VALIDE);
    await user.click(screen.getByRole('button', { name: 'Suivre' }));

    await waitFor(() => expect(actions.addTrackedUrl).toHaveBeenCalled());
    expect(vi.mocked(actions.addTrackedUrl).mock.calls[0][1].get('url')).toBe(URL_VALIDE);
  });

  it('se ferme quand l’URL est acceptée', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AddTrackedUrlModal onClose={onClose} />);

    await user.type(screen.getByRole('textbox'), URL_VALIDE);
    await user.click(screen.getByRole('button', { name: 'Suivre' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('affiche le refus du backend sans se fermer', async () => {
    const onClose = vi.fn();
    vi.mocked(actions.addTrackedUrl).mockResolvedValue({
      error: 'seules les URLs amazon.fr sont suivies pour le moment.',
    });
    const user = userEvent.setup();
    render(<AddTrackedUrlModal onClose={onClose} />);

    await user.type(screen.getByRole('textbox'), 'https://www.fnac.com/dp/B0TEST0001');
    await user.click(screen.getByRole('button', { name: 'Suivre' }));

    expect(
      await screen.findByText('seules les URLs amazon.fr sont suivies pour le moment.'),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('laisse le navigateur refuser une saisie qui n’est pas une URL', async () => {
    const user = userEvent.setup();
    render(<AddTrackedUrlModal onClose={vi.fn()} />);

    await user.type(screen.getByRole('textbox'), 'pas-une-url');
    await user.click(screen.getByRole('button', { name: 'Suivre' }));

    // `type="url"` : la validation HTML bloque avant tout appel réseau.
    expect(actions.addTrackedUrl).not.toHaveBeenCalled();
  });

  it('se ferme à l’échap', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AddTrackedUrlModal onClose={onClose} />);

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
  });
});

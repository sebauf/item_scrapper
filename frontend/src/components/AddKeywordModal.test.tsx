import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/actions', () => ({
  addKeyword: vi.fn().mockResolvedValue({ success: true }),
  addTrackedUrl: vi.fn().mockResolvedValue({ success: true }),
}));

const actions = await import('@/app/actions');
const { AddKeywordModal } = await import('./AddKeywordModal');

/**
 * La modale est un formulaire piloté par `useActionState` : elle n'a pas de
 * logique propre, mais trois comportements attendus par l'utilisateur — elle
 * se ferme quand ça a marché, reste ouverte avec le message quand ça a échoué,
 * et se ferme à l'échap.
 */
describe('AddKeywordModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(actions.addKeyword).mockResolvedValue({ success: true });
  });

  it('donne le focus au champ à l’ouverture', () => {
    render(<AddKeywordModal onClose={vi.fn()} />);

    expect(screen.getByRole('textbox')).toHaveFocus();
  });

  it('soumet le mot-clé saisi', async () => {
    const user = userEvent.setup();
    render(<AddKeywordModal onClose={vi.fn()} />);

    await user.type(screen.getByRole('textbox'), 'lessive liquide');
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));

    await waitFor(() => expect(actions.addKeyword).toHaveBeenCalled());
    const submitted = vi.mocked(actions.addKeyword).mock.calls[0][1];
    expect(submitted.get('keyword')).toBe('lessive liquide');
  });

  it('se ferme quand l’ajout réussit', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AddKeywordModal onClose={onClose} />);

    await user.type(screen.getByRole('textbox'), 'lessive');
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('reste ouverte et affiche le refus du backend', async () => {
    const onClose = vi.fn();
    vi.mocked(actions.addKeyword).mockResolvedValue({
      error: 'Le mot-clé « lessive » est déjà suivi.',
    });
    const user = userEvent.setup();
    render(<AddKeywordModal onClose={onClose} />);

    await user.type(screen.getByRole('textbox'), 'lessive');
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));

    expect(await screen.findByText('Le mot-clé « lessive » est déjà suivi.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('refuse un envoi vide côté navigateur', async () => {
    const user = userEvent.setup();
    render(<AddKeywordModal onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Ajouter' }));

    // `required` sur le champ : la requête ne part pas.
    expect(actions.addKeyword).not.toHaveBeenCalled();
  });

  it.each([
    ['le bouton Annuler', async (user: ReturnType<typeof userEvent.setup>) =>
      user.click(screen.getByRole('button', { name: 'Annuler' }))],
    ['la touche Échap', async (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{Escape}')],
  ])('se ferme par %s', async (_label, act) => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AddKeywordModal onClose={onClose} />);

    await act(user);

    expect(onClose).toHaveBeenCalled();
  });
});

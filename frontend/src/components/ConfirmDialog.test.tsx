import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * Garde-fous du dialogue de confirmation : c'est le dernier écran avant une
 * action destructrice, donc tout ce qui pourrait la déclencher sans intention
 * est testé — le focus initial, Échap, le clic hors du panneau.
 */
describe('ConfirmDialog', () => {
  const props = () => ({
    title: 'Supprimer « lessive » ?',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  });

  it('annonce un dialogue nommé par son titre', () => {
    render(<ConfirmDialog {...props()} />);

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Supprimer « lessive » ?');
  });

  it('confirme sur le bouton destructeur', async () => {
    const user = userEvent.setup();
    const p = props();
    render(<ConfirmDialog {...p} />);

    await user.click(screen.getByRole('button', { name: 'Supprimer' }));

    expect(p.onConfirm).toHaveBeenCalledOnce();
    expect(p.onCancel).not.toHaveBeenCalled();
  });

  it('donne le focus à « Annuler », pas à l’action destructrice', () => {
    render(<ConfirmDialog {...props()} />);

    expect(screen.getByRole('button', { name: 'Annuler' })).toHaveFocus();
  });

  it('renonce sur Échap', async () => {
    const user = userEvent.setup();
    const p = props();
    render(<ConfirmDialog {...p} />);

    await user.keyboard('{Escape}');

    expect(p.onCancel).toHaveBeenCalledOnce();
    expect(p.onConfirm).not.toHaveBeenCalled();
  });

  it('renonce sur un clic hors du panneau', async () => {
    const user = userEvent.setup();
    const p = props();
    const { container } = render(<ConfirmDialog {...p} />);

    await user.click(container.querySelector('.absolute.inset-0')!);

    expect(p.onCancel).toHaveBeenCalledOnce();
  });

  it('verrouille la confirmation pendant la suppression', () => {
    render(<ConfirmDialog {...props()} pending />);

    expect(screen.getByRole('button', { name: 'Suppression…' })).toBeDisabled();
  });
});

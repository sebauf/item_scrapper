import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/actions', () => ({
  addFavoriteAction: vi.fn(),
  removeFavoriteAction: vi.fn(),
}));

const actions = await import('@/app/actions');
const { FavoriteButton } = await import('./FavoriteButton');

/**
 * Bouton optimiste : l'étoile bascule avant la réponse du serveur. Le test qui
 * compte est celui de l'annulation — sans lui, un échec réseau laisserait une
 * étoile qui ment sur l'état réel des favoris.
 */
describe('FavoriteButton', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reflète l’état initial', () => {
    render(<FavoriteButton productId="aWQ" initialFavorite={true} />);

    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button')).toHaveAccessibleName(/Favori/);
  });

  it('ajoute aux favoris au clic', async () => {
    render(<FavoriteButton productId="aWQ" initialFavorite={false} />);

    await userEvent.click(screen.getByRole('button'));

    expect(actions.addFavoriteAction).toHaveBeenCalledWith('aWQ');
    await waitFor(() => expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true'));
  });

  it('retire des favoris au clic suivant', async () => {
    render(<FavoriteButton productId="aWQ" initialFavorite={true} />);

    await userEvent.click(screen.getByRole('button'));

    expect(actions.removeFavoriteAction).toHaveBeenCalledWith('aWQ');
    await waitFor(() => expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false'));
  });

  it('bascule sans attendre la réponse du serveur', async () => {
    let resolveAction: () => void = () => undefined;
    vi.mocked(actions.addFavoriteAction).mockReturnValue(
      new Promise<void>((resolve) => {
        resolveAction = resolve;
      }),
    );
    render(<FavoriteButton productId="aWQ" initialFavorite={false} />);

    await userEvent.click(screen.getByRole('button'));

    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
    resolveAction();
  });

  it('revient en arrière si l’appel échoue', async () => {
    vi.mocked(actions.addFavoriteAction).mockRejectedValue(new Error('réseau'));
    render(<FavoriteButton productId="aWQ" initialFavorite={false} />);

    await userEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false'));
    expect(screen.getByRole('button')).toHaveAccessibleName(/Favoris/);
  });

  it.each([
    [false, 'Ajouter aux favoris'],
    [true, 'Retirer des favoris'],
  ])('propose l’action inverse dans son infobulle (favori: %s)', (initialFavorite, title) => {
    render(<FavoriteButton productId="aWQ" initialFavorite={initialFavorite} />);

    expect(screen.getByRole('button')).toHaveAttribute('title', title);
  });

  it('garde son état après le montage, quoi que dise la prop', async () => {
    // `initialFavorite` n'amorce que le `useState` : une fois monté, le bouton
    // est maître de son affichage. C'est ce qui permet la bascule optimiste —
    // le rendu serveur suivant ne doit pas écraser un clic en cours.
    const { rerender } = render(<FavoriteButton productId="aWQ" initialFavorite={false} />);
    await userEvent.click(screen.getByRole('button'));

    rerender(<FavoriteButton productId="aWQ" initialFavorite={false} />);

    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });
});

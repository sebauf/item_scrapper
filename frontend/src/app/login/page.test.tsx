import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { authMock } from '@/testing/auth-mock';
import { RedirectSignal } from '@/testing/navigation-mock';
import LoginPage from './page';

/**
 * La page de connexion est la seule servie sans session. Ce qu'elle doit
 * garantir : ne jamais boucler avec le middleware, ne jamais renvoyer hors du
 * site, et dire pourquoi un compte est refusé.
 */
async function renderLogin(params: Record<string, string> = {}) {
  render(await LoginPage({ searchParams: Promise.resolve(params) }));
}

describe('LoginPage', () => {
  it('propose la connexion Google à un visiteur sans session', async () => {
    authMock.auth.mockResolvedValueOnce(null);

    await renderLogin();

    expect(screen.getByRole('button', { name: /se connecter avec google/i })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renvoie un utilisateur déjà connecté vers la page demandée', async () => {
    await expect(
      renderLogin({ callbackUrl: 'https://prix.example.fr/keywords' }),
    ).rejects.toEqual(new RedirectSignal('/keywords'));
  });

  it('ne renvoie jamais hors du site, même avec un callbackUrl forgé', async () => {
    await expect(renderLogin({ callbackUrl: '//pirate.example' })).rejects.toEqual(
      new RedirectSignal('/'),
    );
  });

  it('transmet la page demandée à Google comme destination finale', async () => {
    authMock.auth.mockResolvedValueOnce(null);
    await renderLogin({ callbackUrl: 'https://prix.example.fr/favorites' });

    await userEvent.click(screen.getByRole('button', { name: /se connecter avec google/i }));

    expect(authMock.signIn).toHaveBeenCalledWith('google', { redirectTo: '/favorites' });
  });

  it('explique un refus de la liste blanche', async () => {
    authMock.auth.mockResolvedValueOnce(null);

    await renderLogin({ error: 'AccessDenied' });

    expect(screen.getByRole('alert')).toHaveTextContent(/n'est pas autorisé/);
  });

  it('affiche un message générique pour une erreur inconnue', async () => {
    authMock.auth.mockResolvedValueOnce(null);

    await renderLogin({ error: 'OAuthCallbackError' });

    expect(screen.getByRole('alert')).toHaveTextContent('La connexion a échoué');
  });

  /**
   * Le middleware renvoie ici une session dont l'adresse n'est plus autorisée.
   * Rediriger vers l'accueil bouclerait : on propose de changer de compte.
   */
  it('ne boucle pas sur une session dont l’adresse a été retirée de la liste blanche', async () => {
    authMock.hasAccess.mockReturnValue(false);

    await renderLogin();

    expect(screen.getByRole('alert')).toHaveTextContent('alice@example.com');
    await userEvent.click(screen.getByRole('button', { name: /changer de compte/i }));
    expect(authMock.signOut).toHaveBeenCalledWith({ redirectTo: '/login' });
  });
});

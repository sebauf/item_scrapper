import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { authMock } from '@/testing/auth-mock';
import { UserMenu } from './UserMenu';

describe('UserMenu', () => {
  it('affiche le nom de l’utilisateur et son initiale', () => {
    render(<UserMenu name="Alice Martin" email="alice@example.com" />);

    expect(screen.getByText('Alice Martin')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('retombe sur l’adresse quand Google ne donne pas de nom', () => {
    render(<UserMenu name={null} email="bob@example.com" />);

    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
  });

  it('déconnecte et renvoie vers la page de connexion', async () => {
    render(<UserMenu name="Alice" email="alice@example.com" />);

    await userEvent.click(screen.getByRole('button', { name: 'Déconnexion' }));

    expect(authMock.signOut).toHaveBeenCalledWith({ redirectTo: '/login' });
  });
});

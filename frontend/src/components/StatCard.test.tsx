import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatCard } from './StatCard';

describe('StatCard', () => {
  it('affiche la valeur, le libellé et l’icône', () => {
    render(<StatCard value={42} label="Produits suivis" icon="📦" />);

    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Produits suivis')).toBeInTheDocument();
    expect(screen.getByText('📦')).toBeInTheDocument();
  });

  it('accepte une valeur déjà formatée', () => {
    render(<StatCard value="il y a 2h" label="Dernier scrape" icon="🕒" />);

    expect(screen.getByText('il y a 2h')).toBeInTheDocument();
  });

  it('affiche un zéro plutôt que rien', () => {
    render(<StatCard value={0} label="Bonnes affaires" icon="🔥" />);

    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('applique la couleur d’accent demandée', () => {
    render(<StatCard value={7} label="Bonnes affaires" icon="🔥" accent="text-deal" />);

    expect(screen.getByText('7')).toHaveClass('text-deal');
  });
});

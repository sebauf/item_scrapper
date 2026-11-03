import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { aProfile } from '@/testing/fixtures';
import { ProfileForm } from './ProfileForm';

vi.mock('@/app/actions', () => ({ saveProfileAction: vi.fn() }));

describe('ProfileForm', () => {
  it('pré-remplit le numéro et les carburants enregistrés', () => {
    render(<ProfileForm profile={aProfile({ phone: '+33612345678', alertFuels: ['gazole', 'sp98'] })} />);

    expect(screen.getByLabelText('Numéro de téléphone')).toHaveValue('+33612345678');
    expect(screen.getByRole('checkbox', { name: 'Gazole' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'SP98' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'SP95-E10' })).not.toBeChecked();
  });

  it('dit ce qui manque quand l’alerte est inactive', () => {
    render(<ProfileForm profile={aProfile()} />);

    const status = screen.getByRole('region', { name: 'État des alertes carburant' });
    expect(status).toHaveTextContent('Alertes inactives');
    expect(status).toHaveTextContent('renseignez votre numéro de téléphone');
    expect(status).toHaveTextContent('cochez au moins un carburant');
    expect(status).toHaveTextContent('mettez au moins une station en favori');
  });

  it('annonce le numéro destinataire quand l’alerte est active', () => {
    render(
      <ProfileForm
        profile={aProfile({
          phone: '+33612345678',
          alertFuels: ['gazole'],
          favoriteStationCount: 2,
          fuelAlerts: { active: true, missing: [] },
        })}
      />,
    );

    const status = screen.getByRole('region', { name: 'État des alertes carburant' });
    expect(status).toHaveTextContent('Alertes actives');
    expect(status).toHaveTextContent('+33612345678');
    expect(status).toHaveTextContent('l’une de vos 2 stations favorites');
  });

  it.each([
    [0, 'aucune station favorite'],
    [1, 'votre station favorite'],
    [3, 'vos 3 stations favorites'],
  ])('accorde le nombre de stations (%i)', (favoriteStationCount, text) => {
    render(<ProfileForm profile={aProfile({ favoriteStationCount })} />);

    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('renvoie vers la carte pour gérer les stations', () => {
    render(<ProfileForm profile={aProfile()} />);

    expect(screen.getByRole('link', { name: 'Les gérer sur la carte' })).toHaveAttribute('href', '/fuel');
  });
});

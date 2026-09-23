import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { UpdateStatus } from '@/lib/api';
import { UpdateIndicatorView } from './UpdateIndicator';

function aStatus(overrides: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    clusterAvailable: true,
    redeployEnabled: true,
    updateAvailable: false,
    rolloutInProgress: false,
    components: [],
    checkedAt: '2026-09-23T10:00:00.000Z',
    ...overrides,
  };
}

/**
 * L'indicateur est présent sur toutes les pages : il doit rester discret quand
 * il n'y a rien à dire, et ne jamais disparaître — c'est aussi le seul accès à
 * la page Système.
 */
describe('UpdateIndicatorView', () => {
  it('signale une nouvelle version', () => {
    render(<UpdateIndicatorView status={aStatus({ updateAvailable: true })} />);

    expect(screen.getByRole('link', { name: /Mise à jour disponible/ })).toHaveAttribute('href', '/system');
  });

  it('signale un rollout en cours, en priorité sur la mise à jour disponible', () => {
    render(<UpdateIndicatorView status={aStatus({ updateAvailable: true, rolloutInProgress: true })} />);

    expect(screen.getByRole('link', { name: /Mise à jour en cours/ })).toBeInTheDocument();
    expect(screen.queryByText(/disponible/)).not.toBeInTheDocument();
  });

  it.each([
    ['tout est à jour', aStatus()],
    ['le backend est injoignable', null],
  ])('se réduit à la roue dentée quand %s', (_label, status) => {
    render(<UpdateIndicatorView status={status} />);

    expect(screen.getByRole('link', { name: 'Système et mises à jour' })).toHaveAttribute('href', '/system');
  });
});

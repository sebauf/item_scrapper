import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ComponentVersion } from '@/lib/api';
import { ComponentVersionList } from './ComponentVersionList';

const OLD = `sha256:aaaaaaaaaaaa${'0'.repeat(52)}`;
const NEW = `sha256:bbbbbbbbbbbb${'0'.repeat(52)}`;

function aComponent(overrides: Partial<ComponentVersion> = {}): ComponentVersion {
  return {
    name: 'price-tracker-backend',
    image: 'ghcr.io/owner/item_scrapper-backend:main',
    status: 'up-to-date',
    runningDigest: OLD,
    latestDigest: OLD,
    ...overrides,
  };
}

describe('ComponentVersionList', () => {
  it('affiche un libellé lisible et le statut de chaque composant', () => {
    render(<ComponentVersionList components={[aComponent()]} />);

    expect(screen.getByText('API (backend)')).toBeInTheDocument();
    expect(screen.getByText('À jour')).toBeInTheDocument();
  });

  it('montre le passage d’un digest à l’autre pour un composant en retard', () => {
    render(<ComponentVersionList components={[aComponent({ status: 'outdated', latestDigest: NEW })]} />);

    expect(screen.getByText('Nouvelle version')).toBeInTheDocument();
    expect(screen.getByText(/aaaaaaaaaaaa → bbbbbbbbbbbb/)).toBeInTheDocument();
  });

  it('garde le nom technique d’un composant inconnu', () => {
    render(<ComponentVersionList components={[aComponent({ name: 'autre-chose', status: 'unknown', latestDigest: null })]} />);

    expect(screen.getByText('autre-chose')).toBeInTheDocument();
    expect(screen.getByText('Inconnu')).toBeInTheDocument();
  });
});

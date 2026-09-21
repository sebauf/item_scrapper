import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackedUrlSummary } from '@/lib/api';

vi.mock('@/app/actions', () => ({
  deleteTrackedUrl: vi.fn().mockResolvedValue(undefined),
  addTrackedUrl: vi.fn().mockResolvedValue({ success: true }),
}));

const actions = await import('@/app/actions');
const { TrackedUrlDashboard } = await import('./TrackedUrlDashboard');

/**
 * Miroir de KeywordDashboard pour les URLs suivies une à une. Sa particularité :
 * une URL tout juste ajoutée n'a encore ni titre, ni image, ni prix — elle doit
 * rester lisible jusqu'au prochain passage du scrapper.
 */
const TRACKED: TrackedUrlSummary[] = [
  {
    id: 'aWQx',
    url: 'https://www.amazon.fr/dp/B0TEST0001/',
    title: 'Lessive liquide 3L',
    image: 'https://img.example/a.jpg',
    price: { amount: 12.99, currency: 'EUR' },
    lastScrape: '2026-08-08T06:00:00.000Z',
  },
  {
    id: 'aWQy',
    url: 'https://www.amazon.fr/dp/B0TEST0002/',
    title: null,
    image: null,
    price: null,
    lastScrape: null,
  },
];

describe('TrackedUrlDashboard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('affiche le titre, le prix et un lien vers la fiche', () => {
    render(<TrackedUrlDashboard trackedUrls={TRACKED} />);

    expect(screen.getByText('Lessive liquide 3L').closest('a')).toHaveAttribute(
      'href',
      '/product/aWQx',
    );
    expect(screen.getByText(/12,99/)).toBeInTheDocument();
  });

  it('retombe sur l’URL quand le titre manque encore', () => {
    render(<TrackedUrlDashboard trackedUrls={TRACKED} />);

    expect(screen.getByText('https://www.amazon.fr/dp/B0TEST0002/')).toBeInTheDocument();
    expect(screen.getByText('En attente du prochain scrape')).toBeInTheDocument();
  });

  it('cherche dans le titre comme dans l’URL', async () => {
    const user = userEvent.setup();
    render(<TrackedUrlDashboard trackedUrls={TRACKED} />);

    await user.type(screen.getByRole('searchbox'), 'B0TEST0002');

    expect(screen.getByText('https://www.amazon.fr/dp/B0TEST0002/')).toBeInTheDocument();
    expect(screen.queryByText('Lessive liquide 3L')).not.toBeInTheDocument();
  });

  it('annonce une liste vide', () => {
    render(<TrackedUrlDashboard trackedUrls={[]} />);

    expect(screen.getByText(/Aucune URL suivie/)).toBeInTheDocument();
  });

  it('supprime après confirmation, en désignant l’URL par son identifiant', async () => {
    const user = userEvent.setup();
    render(<TrackedUrlDashboard trackedUrls={TRACKED} />);

    await user.click(screen.getAllByTitle('Retirer du suivi')[0]);
    await user.click(screen.getByRole('button', { name: 'Oui' }));

    await waitFor(() => expect(actions.deleteTrackedUrl).toHaveBeenCalledWith('aWQx'));
  });

  it('ouvre la modale d’ajout', async () => {
    const user = userEvent.setup();
    render(<TrackedUrlDashboard trackedUrls={TRACKED} />);

    await user.click(screen.getByRole('button', { name: /Suivre une URL/ }));

    expect(screen.getByRole('textbox')).toHaveAttribute('type', 'url');
  });
});

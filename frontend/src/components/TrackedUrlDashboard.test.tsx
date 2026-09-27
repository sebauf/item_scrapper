import { render, screen, waitFor, within } from '@testing-library/react';
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
 * rester lisible, et restervable, jusqu'au prochain passage du scrapper. C'est
 * elle que la confirmation doit savoir nommer sans titre sous la main.
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

  describe('retrait du suivi', () => {
    const trash = (label: string) =>
      screen.getByRole('button', { name: `Retirer du suivi ${label}` });

    it('expose une corbeille par URL, sans survol', () => {
      render(<TrackedUrlDashboard trackedUrls={TRACKED} />);

      expect(trash('Lessive liquide 3L')).toBeInTheDocument();
      expect(trash('https://www.amazon.fr/dp/B0TEST0002/')).toBeInTheDocument();
    });

    it('demande confirmation avant de retirer', async () => {
      const user = userEvent.setup();
      render(<TrackedUrlDashboard trackedUrls={TRACKED} />);

      await user.click(trash('Lessive liquide 3L'));

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(actions.deleteTrackedUrl).not.toHaveBeenCalled();
    });

    it('retire après confirmation, en désignant l’URL par son identifiant', async () => {
      const user = userEvent.setup();
      render(<TrackedUrlDashboard trackedUrls={TRACKED} />);

      await user.click(trash('Lessive liquide 3L'));
      await user.click(screen.getByRole('button', { name: 'Retirer' }));

      await waitFor(() => expect(actions.deleteTrackedUrl).toHaveBeenCalledWith('aWQx'));
    });

    it('renonce sur « Annuler »', async () => {
      const user = userEvent.setup();
      render(<TrackedUrlDashboard trackedUrls={TRACKED} />);

      await user.click(trash('Lessive liquide 3L'));
      await user.click(screen.getByRole('button', { name: 'Annuler' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(actions.deleteTrackedUrl).not.toHaveBeenCalled();
    });

    it('nomme par l’URL le produit encore sans titre', async () => {
      const user = userEvent.setup();
      render(<TrackedUrlDashboard trackedUrls={TRACKED} />);

      await user.click(trash('https://www.amazon.fr/dp/B0TEST0002/'));

      expect(
        within(screen.getByRole('dialog')).getByText('https://www.amazon.fr/dp/B0TEST0002/'),
      ).toBeInTheDocument();
    });

    it('garde son nom quand la recherche exclut la ligne visée', async () => {
      const user = userEvent.setup();
      render(<TrackedUrlDashboard trackedUrls={TRACKED} />);

      await user.click(trash('Lessive liquide 3L'));
      await user.type(screen.getByRole('searchbox'), 'B0TEST0002');

      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText('Lessive liquide 3L')).toBeInTheDocument();

      await user.click(within(dialog).getByRole('button', { name: 'Retirer' }));
      await waitFor(() => expect(actions.deleteTrackedUrl).toHaveBeenCalledWith('aWQx'));
    });
  });

  it('ouvre la modale d’ajout', async () => {
    const user = userEvent.setup();
    render(<TrackedUrlDashboard trackedUrls={TRACKED} />);

    await user.click(screen.getByRole('button', { name: 'Suivre une URL' }));

    expect(screen.getByRole('textbox')).toHaveAttribute('type', 'url');
  });
});

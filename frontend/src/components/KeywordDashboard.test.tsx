import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeywordSummary } from '@/lib/api';

vi.mock('@/app/actions', () => ({
  deleteKeyword: vi.fn().mockResolvedValue(undefined),
  addKeyword: vi.fn().mockResolvedValue({ success: true }),
}));

const actions = await import('@/app/actions');
const { KeywordDashboard } = await import('./KeywordDashboard');

/**
 * Liste des mots-clés suivis. Le point sensible est la suppression : elle
 * demande une confirmation, parce qu'elle arrête le scrape — contrairement au
 * retrait d'un favori, qui est sans conséquence.
 *
 * La corbeille est cherchée par son libellé accessible, pas par un survol : sur
 * mobile il n'y a pas de survol, et c'est précisément ce qui rendait la
 * suppression introuvable.
 */
const KEYWORDS: KeywordSummary[] = [
  { keyword: 'lessive', productCount: 42, lastScrape: '2026-08-08T06:00:00.000Z' },
  { keyword: 'café', productCount: 1, lastScrape: '2026-08-07T06:00:00.000Z' },
  { keyword: 'aspirateur', productCount: 0, lastScrape: null },
];

describe('KeywordDashboard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('liste les mots-clés avec un lien vers leurs produits', () => {
    render(<KeywordDashboard keywords={KEYWORDS} />);

    expect(screen.getByText('lessive').closest('a')).toHaveAttribute('href', '/keyword/lessive');
    expect(screen.getByText('42 produits')).toBeInTheDocument();
  });

  it('accorde le singulier', () => {
    render(<KeywordDashboard keywords={KEYWORDS} />);

    expect(screen.getByText('1 produit')).toBeInTheDocument();
  });

  it('signale un mot-clé encore jamais scrapé', () => {
    render(<KeywordDashboard keywords={KEYWORDS} />);

    expect(screen.getByText('En attente')).toBeInTheDocument();
  });

  it('encode un mot-clé à espaces dans son lien', () => {
    render(
      <KeywordDashboard
        keywords={[{ keyword: 'lessive liquide', productCount: 3, lastScrape: null }]}
      />,
    );

    expect(screen.getByText('lessive liquide').closest('a')).toHaveAttribute(
      'href',
      '/keyword/lessive%20liquide',
    );
  });

  describe('recherche locale', () => {
    it('filtre sans distinction de casse', async () => {
      const user = userEvent.setup();
      render(<KeywordDashboard keywords={KEYWORDS} />);

      await user.type(screen.getByRole('searchbox'), 'LESS');

      expect(screen.getByText('lessive')).toBeInTheDocument();
      expect(screen.queryByText('café')).not.toBeInTheDocument();
    });

    it('explique une recherche sans résultat', async () => {
      const user = userEvent.setup();
      render(<KeywordDashboard keywords={KEYWORDS} />);

      await user.type(screen.getByRole('searchbox'), 'zzz');

      expect(screen.getByText(/Aucun résultat pour/)).toBeInTheDocument();
    });

    it('distingue « aucun résultat » de « aucune donnée »', () => {
      render(<KeywordDashboard keywords={[]} />);

      expect(screen.getByText(/lancez le scrapper/)).toBeInTheDocument();
      expect(screen.queryByText(/Aucun résultat/)).not.toBeInTheDocument();
    });
  });

  describe('suppression', () => {
    const trash = (keyword: string) =>
      screen.getByRole('button', { name: `Supprimer le mot-clé ${keyword}` });

    it('expose une corbeille par mot-clé, sans survol', () => {
      render(<KeywordDashboard keywords={KEYWORDS} />);

      expect(trash('lessive')).toBeInTheDocument();
      expect(trash('café')).toBeInTheDocument();
      expect(trash('aspirateur')).toBeInTheDocument();
    });

    it('demande confirmation avant de supprimer', async () => {
      const user = userEvent.setup();
      render(<KeywordDashboard keywords={KEYWORDS} />);

      await user.click(trash('lessive'));

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(actions.deleteKeyword).not.toHaveBeenCalled();
    });

    it('nomme le mot-clé visé dans la confirmation', async () => {
      const user = userEvent.setup();
      render(<KeywordDashboard keywords={KEYWORDS} />);

      await user.click(trash('café'));

      expect(screen.getByRole('heading', { name: /« café »/ })).toBeInTheDocument();
    });

    it('supprime après confirmation', async () => {
      const user = userEvent.setup();
      render(<KeywordDashboard keywords={KEYWORDS} />);

      await user.click(trash('lessive'));
      await user.click(screen.getByRole('button', { name: 'Supprimer' }));

      await waitFor(() => expect(actions.deleteKeyword).toHaveBeenCalledWith('lessive'));
    });

    it('renonce sur « Annuler »', async () => {
      const user = userEvent.setup();
      render(<KeywordDashboard keywords={KEYWORDS} />);

      await user.click(trash('lessive'));
      await user.click(screen.getByRole('button', { name: 'Annuler' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(actions.deleteKeyword).not.toHaveBeenCalled();
    });

    it('ne confirme que pour le mot-clé visé', async () => {
      const user = userEvent.setup();
      render(<KeywordDashboard keywords={KEYWORDS} />);

      await user.click(trash('café'));
      await user.click(screen.getByRole('button', { name: 'Supprimer' }));

      await waitFor(() => expect(actions.deleteKeyword).toHaveBeenCalledWith('café'));
    });
  });

  it('ouvre la modale d’ajout', async () => {
    const user = userEvent.setup();
    render(<KeywordDashboard keywords={KEYWORDS} />);

    await user.click(screen.getByRole('button', { name: 'Ajouter un mot-clé' }));

    expect(screen.getByRole('heading', { name: 'Ajouter un mot-clé' })).toBeInTheDocument();
  });
});

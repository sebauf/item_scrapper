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
    it('demande confirmation avant de supprimer', async () => {
      const user = userEvent.setup();
      render(<KeywordDashboard keywords={KEYWORDS} />);

      await user.click(screen.getAllByTitle('Désactiver ce mot-clé')[0]);

      expect(screen.getByText('Supprimer ?')).toBeInTheDocument();
      expect(actions.deleteKeyword).not.toHaveBeenCalled();
    });

    it('supprime après confirmation', async () => {
      const user = userEvent.setup();
      render(<KeywordDashboard keywords={KEYWORDS} />);

      await user.click(screen.getAllByTitle('Désactiver ce mot-clé')[0]);
      await user.click(screen.getByRole('button', { name: 'Oui' }));

      await waitFor(() => expect(actions.deleteKeyword).toHaveBeenCalledWith('lessive'));
    });

    it('renonce sur « Non »', async () => {
      const user = userEvent.setup();
      render(<KeywordDashboard keywords={KEYWORDS} />);

      await user.click(screen.getAllByTitle('Désactiver ce mot-clé')[0]);
      await user.click(screen.getByRole('button', { name: 'Non' }));

      expect(screen.queryByText('Supprimer ?')).not.toBeInTheDocument();
      expect(actions.deleteKeyword).not.toHaveBeenCalled();
    });

    it('ne confirme que pour le mot-clé visé', async () => {
      const user = userEvent.setup();
      render(<KeywordDashboard keywords={KEYWORDS} />);

      await user.click(screen.getAllByTitle('Désactiver ce mot-clé')[1]);
      await user.click(screen.getByRole('button', { name: 'Oui' }));

      await waitFor(() => expect(actions.deleteKeyword).toHaveBeenCalledWith('café'));
    });
  });

  it('ouvre la modale d’ajout', async () => {
    const user = userEvent.setup();
    render(<KeywordDashboard keywords={KEYWORDS} />);

    await user.click(screen.getByRole('button', { name: /Ajouter/ }));

    expect(screen.getByRole('heading', { name: 'Ajouter un mot-clé' })).toBeInTheDocument();
  });
});

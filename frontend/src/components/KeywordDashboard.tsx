'use client';
import { useState, useMemo, useTransition } from 'react';
import Link from 'next/link';
import type { KeywordSummary } from '@/lib/api';
import { deleteKeyword } from '@/app/actions';
import { AddKeywordModal } from './AddKeywordModal';
import { ConfirmDialog } from './ConfirmDialog';

export function KeywordDashboard({ keywords }: { keywords: KeywordSummary[] }) {
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    if (!search.trim()) return keywords;
    const q = search.toLowerCase();
    return keywords.filter((k) => k.keyword.toLowerCase().includes(q));
  }, [keywords, search]);

  function handleDelete(keyword: string) {
    startTransition(async () => {
      await deleteKeyword(keyword);
      setConfirmDelete(null);
    });
  }

  return (
    <div>
      {/* Search bar + Add button */}
      <div className="flex gap-2 sm:gap-3 mb-6">
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-faint pointer-events-none"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {/* text-base sous sm : en dessous de 16px, iOS zoome sur le champ au focus */}
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un mot-clé…"
            className="w-full h-12 sm:h-auto pl-10 pr-4 sm:py-2.5 rounded-xl border border-border bg-surface focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft text-base sm:text-sm transition-shadow"
          />
        </div>
        <button
          onClick={() => setShowModal(true)}
          aria-label="Ajouter un mot-clé"
          className="flex items-center justify-center gap-2 w-12 h-12 sm:w-auto sm:h-auto px-0 sm:px-4 sm:py-2.5 bg-accent text-on-accent rounded-xl text-sm font-semibold hover:bg-accent-hover active:scale-95 transition-all shadow-sm whitespace-nowrap"
        >
          <svg className="w-5 h-5 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          <span className="hidden sm:inline">Ajouter</span>
        </button>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-faint">
          {search ? (
            <>
              <p className="text-4xl mb-3">🔍</p>
              <p>Aucun résultat pour &ldquo;{search}&rdquo;</p>
            </>
          ) : (
            <>
              <p className="text-4xl mb-3">📭</p>
              <p>Aucune donnée — lancez le scrapper d&apos;abord.</p>
            </>
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((k) => (
            /*
             * Le lien et la corbeille sont deux zones voisines, jamais
             * superposées : sur une liste tactile, un bouton posé au-dessus du
             * lien se tape par accident dans un sens comme dans l'autre.
             */
            <li
              key={k.keyword}
              className="group flex items-stretch rounded-xl border border-border bg-surface overflow-hidden focus-within:border-accent/40 hover:border-accent/40 transition-colors"
            >
              <Link
                href={`/keyword/${encodeURIComponent(k.keyword)}`}
                className="flex-1 min-w-0 flex items-center gap-3 px-4 sm:px-5 py-3.5 hover:bg-accent-soft/40 active:bg-accent-soft/60 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground truncate">{k.keyword}</span>
                    {k.productCount === 0 && (
                      <span className="shrink-0 text-xs text-warn bg-warn-soft border border-warn-border px-2 py-0.5 rounded-full">
                        En attente
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-xs sm:text-sm text-muted">
                    {k.productCount > 0 && (
                      <span>
                        {k.productCount} produit{k.productCount !== 1 ? 's' : ''}
                      </span>
                    )}
                    {k.productCount > 0 && k.lastScrape && <span className="text-ghost">·</span>}
                    {k.lastScrape && (
                      <span className="text-faint">
                        {new Date(k.lastScrape).toLocaleDateString('fr-FR')}
                      </span>
                    )}
                  </div>
                </div>
                <svg
                  className="shrink-0 w-4 h-4 text-ghost group-hover:text-accent transition-colors"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>

              {/*
               * Toujours visible : la révélation au survol qu'elle remplace
               * n'existe pas sur un écran tactile, où la corbeille était donc
               * introuvable. Cible pleine hauteur, 56px de large.
               */}
              <button
                onClick={() => setConfirmDelete(k.keyword)}
                aria-label={`Supprimer le mot-clé ${k.keyword}`}
                title="Désactiver ce mot-clé"
                className="shrink-0 w-14 flex items-center justify-center border-l border-border-subtle text-faint hover:text-danger hover:bg-danger-soft active:bg-danger-soft active:text-danger focus-visible:outline-none focus-visible:text-danger focus-visible:bg-danger-soft transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      {confirmDelete !== null && (
        <ConfirmDialog
          title={`Supprimer « ${confirmDelete} » ?`}
          description="Le mot-clé ne sera plus scrapé. Les produits déjà relevés restent en base."
          pending={isPending}
          onConfirm={() => handleDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {showModal && <AddKeywordModal onClose={() => setShowModal(false)} />}
    </div>
  );
}

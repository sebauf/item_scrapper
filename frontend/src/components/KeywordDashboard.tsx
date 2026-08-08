'use client';
import { useState, useMemo, useTransition } from 'react';
import Link from 'next/link';
import type { KeywordSummary } from '@/lib/api';
import { deleteKeyword } from '@/app/actions';
import { AddKeywordModal } from './AddKeywordModal';

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
      <div className="flex gap-3 mb-6">
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-faint pointer-events-none"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un mot-clé…"
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-surface focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft text-sm transition-shadow"
          />
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-accent text-on-accent rounded-xl text-sm font-semibold hover:bg-accent-hover active:scale-95 transition-all shadow-sm whitespace-nowrap"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
        <div className="flex flex-col gap-2">
          {filtered.map((k) => (
            <div key={k.keyword} className="group relative flex items-stretch">
              <Link
                href={`/keyword/${encodeURIComponent(k.keyword)}`}
                className="flex-1 flex items-center justify-between px-5 py-4 rounded-xl border border-border bg-surface hover:border-accent/40 hover:bg-accent-soft/40 transition-all"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="font-semibold text-foreground truncate">{k.keyword}</span>
                  {k.productCount === 0 && (
                    <span className="shrink-0 text-xs text-warn bg-warn-soft border border-warn-border px-2 py-0.5 rounded-full">
                      En attente
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-sm text-muted shrink-0 ml-4">
                  {k.productCount > 0 && (
                    <span>
                      {k.productCount} produit{k.productCount !== 1 ? 's' : ''}
                    </span>
                  )}
                  {k.lastScrape && (
                    <span className="hidden sm:block text-faint">
                      {new Date(k.lastScrape).toLocaleDateString('fr-FR')}
                    </span>
                  )}
                  <svg
                    className="w-4 h-4 text-ghost group-hover:text-accent transition-colors"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </Link>

              {/* Delete control — appears on hover */}
              <div className="absolute right-12 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {confirmDelete === k.keyword ? (
                  <div className="flex items-center gap-2 bg-surface border border-danger/30 rounded-lg px-3 py-1.5 shadow-md">
                    <span className="text-xs text-muted">Supprimer ?</span>
                    <button
                      onClick={() => handleDelete(k.keyword)}
                      disabled={isPending}
                      className="text-xs font-semibold text-danger hover:underline disabled:opacity-50"
                    >
                      Oui
                    </button>
                    <span className="text-ghost">·</span>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="text-xs text-faint hover:text-muted"
                    >
                      Non
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(k.keyword)}
                    className="p-2 text-ghost hover:text-danger hover:bg-danger-soft rounded-lg transition-colors"
                    title="Désactiver ce mot-clé"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && <AddKeywordModal onClose={() => setShowModal(false)} />}
    </div>
  );
}

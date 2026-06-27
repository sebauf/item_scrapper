'use client';
import { useState, useMemo, useTransition } from 'react';
import Link from 'next/link';
import type { KeywordSummary } from '@/types/product';
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
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
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
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 bg-white focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 text-sm transition-shadow"
          />
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 active:scale-95 transition-all shadow-sm whitespace-nowrap"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          <span className="hidden sm:inline">Ajouter</span>
        </button>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
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
                className="flex-1 flex items-center justify-between px-5 py-4 rounded-xl border border-gray-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/40 transition-all"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="font-semibold text-gray-900 truncate">{k.keyword}</span>
                  {k.productCount === 0 && (
                    <span className="shrink-0 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                      En attente
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-sm text-gray-500 shrink-0 ml-4">
                  {k.productCount > 0 && (
                    <span>
                      {k.productCount} produit{k.productCount !== 1 ? 's' : ''}
                    </span>
                  )}
                  {k.lastScrape && (
                    <span className="hidden sm:block text-gray-400">
                      {new Date(k.lastScrape).toLocaleDateString('fr-FR')}
                    </span>
                  )}
                  <svg
                    className="w-4 h-4 text-gray-300 group-hover:text-indigo-400 transition-colors"
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
                  <div className="flex items-center gap-2 bg-white border border-rose-200 rounded-lg px-3 py-1.5 shadow-md">
                    <span className="text-xs text-gray-500">Supprimer ?</span>
                    <button
                      onClick={() => handleDelete(k.keyword)}
                      disabled={isPending}
                      className="text-xs font-semibold text-rose-600 hover:text-rose-800 disabled:opacity-50"
                    >
                      Oui
                    </button>
                    <span className="text-gray-300">·</span>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="text-xs text-gray-400 hover:text-gray-600"
                    >
                      Non
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(k.keyword)}
                    className="p-2 text-gray-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
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

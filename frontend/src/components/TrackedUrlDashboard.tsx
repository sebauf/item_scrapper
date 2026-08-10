'use client';
import { useState, useMemo, useTransition } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import type { TrackedUrlSummary } from '@/lib/api';
import { formatPrice } from '@/lib/format';
import { deleteTrackedUrl } from '@/app/actions';
import { AddTrackedUrlModal } from './AddTrackedUrlModal';

export function TrackedUrlDashboard({ trackedUrls }: { trackedUrls: TrackedUrlSummary[] }) {
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    if (!search.trim()) return trackedUrls;
    const q = search.toLowerCase();
    return trackedUrls.filter(
      (t) => (t.title ?? '').toLowerCase().includes(q) || t.url.toLowerCase().includes(q),
    );
  }, [trackedUrls, search]);

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteTrackedUrl(id);
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
            placeholder="Rechercher un produit suivi…"
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
          <span className="hidden sm:inline">Suivre une URL</span>
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
              <p className="text-4xl mb-3">🔗</p>
              <p>Aucune URL suivie individuellement pour l&apos;instant.</p>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((t) => (
            <div key={t.id} className="group relative flex items-stretch">
              <Link
                href={`/product/${t.id}`}
                className="flex-1 flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-surface hover:border-accent/40 hover:bg-accent-soft/40 transition-all min-w-0"
              >
                <div className="relative w-12 h-12 shrink-0 rounded-lg bg-image-bg overflow-hidden border border-border-subtle">
                  {t.image ? (
                    <Image src={t.image} alt="" fill className="object-contain p-1" sizes="48px" />
                  ) : (
                    <div className="h-full flex items-center justify-center text-ghost">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  {t.title ? (
                    <p className="font-medium text-foreground truncate">{t.title}</p>
                  ) : (
                    <p className="text-faint truncate">{t.url}</p>
                  )}
                  <p className="text-xs text-faint truncate">
                    {t.lastScrape
                      ? `Relevé le ${new Date(t.lastScrape).toLocaleDateString('fr-FR')}`
                      : 'En attente du prochain scrape'}
                  </p>
                </div>

                {t.price && (
                  <span className="shrink-0 font-semibold text-foreground">
                    {formatPrice(t.price.amount, t.price.currency)}
                  </span>
                )}

                <svg
                  className="w-4 h-4 text-ghost group-hover:text-accent transition-colors shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>

              {/* Delete control — appears on hover */}
              <div className="absolute right-12 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {confirmDelete === t.id ? (
                  <div className="flex items-center gap-2 bg-surface border border-danger/30 rounded-lg px-3 py-1.5 shadow-md">
                    <span className="text-xs text-muted">Retirer ?</span>
                    <button
                      onClick={() => handleDelete(t.id)}
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
                    onClick={() => setConfirmDelete(t.id)}
                    className="p-2 text-ghost hover:text-danger hover:bg-danger-soft rounded-lg transition-colors"
                    title="Retirer du suivi"
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

      {showModal && <AddTrackedUrlModal onClose={() => setShowModal(false)} />}
    </div>
  );
}

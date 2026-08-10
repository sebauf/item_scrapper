'use client';
import { useState, useTransition } from 'react';
import { addFavoriteAction, removeFavoriteAction } from '@/app/actions';

export function FavoriteButton({
  productId,
  initialFavorite,
}: {
  productId: string;
  initialFavorite: boolean;
}) {
  const [isFavorite, setIsFavorite] = useState(initialFavorite);
  const [isPending, startTransition] = useTransition();

  function toggle() {
    const next = !isFavorite;
    setIsFavorite(next); // optimiste : le bouton étoile ne doit pas attendre l'aller-retour
    startTransition(async () => {
      try {
        await (next ? addFavoriteAction(productId) : removeFavoriteAction(productId));
      } catch {
        setIsFavorite(!next); // rollback si l'appel échoue
      }
    });
  }

  return (
    <button
      onClick={toggle}
      disabled={isPending}
      aria-pressed={isFavorite}
      title={isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
      className={`inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold shadow-sm transition-colors disabled:opacity-60 ${
        isFavorite
          ? 'bg-warn-soft text-warn border border-warn-border hover:bg-warn-soft/70'
          : 'bg-surface text-muted border border-border hover:border-accent/40 hover:text-accent'
      }`}
    >
      <svg
        className="w-4 h-4"
        fill={isFavorite ? 'currentColor' : 'none'}
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.914c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.783-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
        />
      </svg>
      {isFavorite ? 'Favori' : 'Favoris'}
    </button>
  );
}

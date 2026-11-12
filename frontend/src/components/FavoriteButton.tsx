'use client';
import { useState, useTransition } from 'react';
import { addFavoriteAction, removeFavoriteAction } from '@/app/actions';
import { StarIcon } from './StarIcon';

export function FavoriteButton({
  productId,
  initialFavorite,
}: {
  productId: string;
  initialFavorite: boolean;
}) {
  const [isFavorite, setIsFavorite] = useState(initialFavorite);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    const next = !isFavorite;
    setIsFavorite(next); // optimiste : le bouton étoile ne doit pas attendre l'aller-retour
    setError(null);
    startTransition(async () => {
      try {
        if (next) {
          const result = await addFavoriteAction(productId);
          // Refus métier (quota atteint…) : on annule et on dit pourquoi.
          if (result?.error) {
            setIsFavorite(false);
            setError(result.error);
          }
        } else {
          await removeFavoriteAction(productId);
        }
      } catch {
        setIsFavorite(!next); // rollback si l'appel échoue
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
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
        <StarIcon filled={isFavorite} className="w-4 h-4" />
        {isFavorite ? 'Favori' : 'Favoris'}
      </button>
      {error && (
        <p role="alert" className="text-sm text-warn">
          {error}
        </p>
      )}
    </div>
  );
}

'use client';
import { useState, useTransition } from 'react';
import { addFavoriteStationAction, removeFavoriteStationAction } from '@/app/actions';

/**
 * Étoile compacte d'une station. Même contrat que `FavoriteButton` (produits) :
 * bascule optimiste, annulée si l'appel échoue — une étoile allumée doit
 * vouloir dire que l'alerte de réapprovisionnement surveille bien la station.
 */
export function FavoriteStationButton({
  stationId,
  initialFavorite,
}: {
  stationId: string;
  initialFavorite: boolean;
}) {
  const [isFavorite, setIsFavorite] = useState(initialFavorite);
  const [isPending, startTransition] = useTransition();

  function toggle() {
    const next = !isFavorite;
    setIsFavorite(next);
    startTransition(async () => {
      try {
        await (next ? addFavoriteStationAction(stationId) : removeFavoriteStationAction(stationId));
      } catch {
        setIsFavorite(!next);
      }
    });
  }

  const label = isFavorite ? 'Retirer des stations favorites' : 'Ajouter aux stations favorites';
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={isPending}
      aria-pressed={isFavorite}
      aria-label={label}
      title={isFavorite ? `${label} (alerte de réapprovisionnement active)` : label}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors disabled:opacity-60 ${
        isFavorite
          ? 'bg-warn-soft text-warn border-warn-border hover:bg-warn-soft/70'
          : 'bg-surface text-muted border-border hover:border-accent/40 hover:text-accent'
      }`}
    >
      <svg className="h-4 w-4" fill={isFavorite ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.914c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.783-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
        />
      </svg>
    </button>
  );
}

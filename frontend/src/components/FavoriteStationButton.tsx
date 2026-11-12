'use client';
import { useState, useTransition } from 'react';
import { addFavoriteStationAction, removeFavoriteStationAction } from '@/app/actions';
import { StarIcon } from './StarIcon';

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
      title={isFavorite ? `${label} (surveillée par vos alertes carburant)` : label}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors disabled:opacity-60 ${
        isFavorite
          ? 'bg-warn-soft text-warn border-warn-border hover:bg-warn-soft/70'
          : 'bg-surface text-muted border-border hover:border-accent/40 hover:text-accent'
      }`}
    >
      <StarIcon filled={isFavorite} className="h-4 w-4" />
    </button>
  );
}

'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const REFRESH_INTERVAL_MS = 5_000;

/**
 * Rafraîchit la page serveur tant qu'un rollout est en cours, pour que
 * l'utilisateur voie les composants passer « à jour » sans recharger.
 *
 * `router.refresh()` refait le rendu serveur sans perdre l'état client (le
 * formulaire, notamment). Pendant le redémarrage du frontend lui-même, une
 * requête peut échouer : la suivante tombera sur le nouveau Pod.
 */
export function RolloutRefresher({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [active, router]);

  return null;
}

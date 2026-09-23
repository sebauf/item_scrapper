import Link from 'next/link';
import { connection } from 'next/server';
import { getUpdateStatus, type UpdateStatus } from '@/lib/api';

const gearIcon = (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

/**
 * Accès à la page Système, dans l'en-tête de toutes les pages. Se contente
 * d'une roue dentée quand tout est à jour ; devient une pastille quand une
 * nouvelle version est publiée ou qu'une mise à jour est en cours.
 *
 * Séparé de `UpdateIndicator` pour être testable sans appel réseau.
 */
export function UpdateIndicatorView({ status }: { status: UpdateStatus | null }) {
  if (status?.rolloutInProgress) {
    return (
      <Link
        href="/system"
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-accent-soft text-accent border border-accent/30"
      >
        <span className="w-2 h-2 rounded-full bg-accent animate-pulse" aria-hidden="true" />
        Mise à jour en cours…
      </Link>
    );
  }

  if (status?.updateAvailable) {
    return (
      <Link
        href="/system"
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-warn-soft text-warn border border-warn-border hover:bg-warn-soft/70 transition-colors"
      >
        <span className="relative flex w-2 h-2" aria-hidden="true">
          <span className="absolute inset-0 rounded-full bg-warn opacity-75 animate-ping" />
          <span className="relative w-2 h-2 rounded-full bg-warn" />
        </span>
        Mise à jour disponible
      </Link>
    );
  }

  return <SystemLink />;
}

export function SystemLink() {
  return (
    <Link
      href="/system"
      title="Système et mises à jour"
      aria-label="Système et mises à jour"
      className="p-2 rounded-lg text-faint hover:text-foreground hover:bg-surface-hover transition-colors"
    >
      {gearIcon}
    </Link>
  );
}

/**
 * Version serveur : interroge le backend à chaque rendu (il met en cache les
 * réponses du registre, l'appel est donc léger). Rendu sous `<Suspense>` dans
 * le layout : un backend lent ne retarde pas l'affichage de la page.
 */
export async function UpdateIndicator() {
  // Rend l'appel explicitement dynamique : sans ça, l'erreur que Next lève pour
  // signaler un rendu dynamique pendant le build serait avalée par le catch.
  await connection();

  let status: UpdateStatus | null = null;
  try {
    status = await getUpdateStatus();
  } catch {
    // Un indicateur ne doit jamais faire tomber la page : on affiche la roue seule.
  }
  return <UpdateIndicatorView status={status} />;
}

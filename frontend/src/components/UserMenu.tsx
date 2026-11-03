import Link from 'next/link';
import { signOut } from '@/auth';

/**
 * Utilisateur connecté et déconnexion, à droite de l'en-tête. L'initiale et
 * le nom mènent au profil (numéro de téléphone et alertes carburant) ;
 * l'initiale reste visible sur mobile, où c'est le seul accès au profil.
 *
 * Composant serveur : la déconnexion est une Server Action (`signOut`
 * d'Auth.js efface le cookie de session), aucun JavaScript client n'est
 * nécessaire.
 */
export function UserMenu({ name, email }: { name: string | null; email: string }) {
  const label = name ?? email;
  const initial = label.trim().charAt(0).toUpperCase() || '?';

  return (
    <div className="ml-auto flex items-center gap-3 min-w-0">
      <Link
        href="/profile"
        className="flex items-center gap-3 min-w-0 rounded-lg hover:text-foreground"
        title={`Profil et alertes (${email})`}
        aria-label="Profil"
      >
        <span
          className="flex w-8 h-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent text-sm font-semibold"
          aria-hidden
        >
          {initial}
        </span>
        <span className="hidden lg:block text-sm text-muted truncate max-w-48">{label}</span>
      </Link>
      <form
        action={async () => {
          'use server';
          await signOut({ redirectTo: '/login' });
        }}
      >
        <button
          type="submit"
          className="px-3 py-1.5 rounded-lg text-sm font-medium text-muted hover:text-foreground hover:bg-surface-hover transition-colors"
          title={`Se déconnecter (${email})`}
        >
          Déconnexion
        </button>
      </form>
    </div>
  );
}

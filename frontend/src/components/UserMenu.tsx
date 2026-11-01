import { signOut } from '@/auth';

/**
 * Utilisateur connecté et déconnexion, à droite de l'en-tête.
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
      <span
        className="hidden sm:flex w-8 h-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent text-sm font-semibold"
        aria-hidden
      >
        {initial}
      </span>
      <span className="hidden lg:block text-sm text-muted truncate max-w-48" title={email}>
        {label}
      </span>
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

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth, hasAccess, signIn, signOut } from '@/auth';
import { safeCallbackPath } from '@/lib/auth-policy';

export const metadata: Metadata = { title: 'Connexion — Price Tracker' };

/**
 * Codes d'erreur qu'Auth.js place dans `?error=` (cf. `pages.error`).
 * `AccessDenied` = le callback `signIn` a refusé le compte (liste blanche,
 * adresse non vérifiée).
 */
const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied: "Ce compte Google n'est pas autorisé à accéder à l'application.",
  Configuration: "L'authentification est mal configurée côté serveur.",
};
const DEFAULT_ERROR = 'La connexion a échoué. Réessayez.';

type SearchParams = Promise<{ callbackUrl?: string | string[]; error?: string | string[] }>;

/**
 * Seule page accessible sans session (avec les routes d'Auth.js) — cf. le
 * `matcher` de middleware.ts.
 */
export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const callbackPath = safeCallbackPath(params.callbackUrl);
  const session = await auth();
  const email = session?.user?.email ?? null;

  // Déjà connecté avec un compte autorisé : rien à faire ici.
  if (email && hasAccess(email)) redirect(callbackPath);

  // Session valide mais adresse retirée de la liste blanche depuis.
  const revoked = email !== null;
  const errorCode = Array.isArray(params.error) ? params.error[0] : params.error;
  const error = revoked
    ? `Le compte ${email} n'est plus autorisé à accéder à l'application.`
    : errorCode
      ? (ERROR_MESSAGES[errorCode] ?? DEFAULT_ERROR)
      : null;

  return (
    <main className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm bg-surface border border-border rounded-2xl shadow-sm p-8 text-center">
        <div className="text-4xl leading-none mb-4" aria-hidden>
          📈
        </div>
        <h1 className="text-xl font-bold text-foreground">Connexion</h1>
        <p className="mt-2 text-sm text-muted">
          Vos mots-clés, favoris et stations sont rattachés à votre compte Google.
        </p>

        {error && (
          <p
            role="alert"
            className="mt-6 rounded-lg border border-warn-border bg-warn-soft px-3 py-2 text-sm text-warn"
          >
            {error}
          </p>
        )}

        {revoked ? (
          <form
            className="mt-6"
            action={async () => {
              'use server';
              await signOut({ redirectTo: '/login' });
            }}
          >
            <button
              type="submit"
              className="w-full rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-surface-hover transition-colors"
            >
              Changer de compte
            </button>
          </form>
        ) : (
          <form
            className="mt-6"
            action={async () => {
              'use server';
              await signIn('google', { redirectTo: callbackPath });
            }}
          >
            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-3 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent hover:bg-accent-hover transition-colors"
            >
              <GoogleIcon />
              Se connecter avec Google
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg className="w-4 h-4 rounded-sm bg-white p-px" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

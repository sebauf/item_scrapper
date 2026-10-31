/**
 * Qui a le droit d'entrer — règles pures, sans Auth.js, pour être testées
 * telles quelles et partagées par la connexion et le middleware.
 */

/**
 * Liste blanche `AUTH_ALLOWED_EMAILS` : adresses séparées par des virgules,
 * casse et espaces ignorés. Vide = tout compte Google à l'adresse vérifiée.
 *
 * Vide est permis mais déconseillé dès que l'application est joignable
 * d'Internet : chaque mot-clé ajouté coûte du budget de crawl
 * (`KNOWN_PRODUCTS_LIMIT_PER_KEYWORD` relectures par jour, sur un plafond
 * global de `MAX_REQUESTS_PER_CRAWL`), et un inconnu pourrait l'épuiser.
 */
export function parseAllowedEmails(raw: string | undefined): ReadonlySet<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isEmailAllowed(
  email: string | null | undefined,
  allowed: ReadonlySet<string>,
): boolean {
  if (!email) return false;
  return allowed.size === 0 || allowed.has(email.trim().toLowerCase());
}

/**
 * Le profil Google renvoyé à la connexion est-il recevable ?
 *
 * `email_verified` est exigé : l'adresse devient l'identifiant de l'utilisateur
 * côté backend (ses mots-clés, ses favoris), elle doit donc être prouvée — un
 * compte Google créé avec l'adresse d'un tiers, jamais vérifiée, ne doit pas
 * hériter de ses données.
 */
export function isProfileAllowed(
  profile: { email?: string | null; email_verified?: boolean | null } | undefined,
  allowed: ReadonlySet<string>,
): boolean {
  return profile?.email_verified === true && isEmailAllowed(profile.email, allowed);
}

/**
 * Où revenir après la connexion.
 *
 * Auth.js transmet dans `callbackUrl` l'URL **complète** de la page demandée.
 * On n'en garde que le chemin (+ requête, + ancre) : la redirection reste donc
 * toujours sur ce site, même si `callbackUrl` a été forgé pour pointer ailleurs
 * — sans quoi la page de connexion deviendrait une redirection ouverte, utile
 * pour du hameçonnage. `/login` lui-même est écarté pour ne pas boucler.
 */
export function safeCallbackPath(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return '/';

  let url: URL;
  try {
    url = new URL(value, 'http://placeholder.invalid');
  } catch {
    return '/';
  }
  const path = `${url.pathname}${url.search}${url.hash}`;
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/login')) return '/';
  return path;
}

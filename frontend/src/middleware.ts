/**
 * Toute page exige une session — sauf la page de connexion, les routes
 * d'Auth.js, la sonde de santé et les fichiers statiques (cf. `matcher`).
 *
 * Le filtrage se fait ici, avant tout rendu : une page oubliée ne peut pas
 * s'afficher sans session. La décision elle-même est `authorized` dans
 * `auth.ts` ; refusée, la requête est redirigée vers `/login?callbackUrl=…`.
 *
 * Ce n'est pas la seule barrière : le backend refuse de son côté toute
 * requête sans jeton signé (cf. lib/internal-token.ts).
 */
export { auth as middleware } from '@/auth';

export const config = {
  matcher: ['/((?!api/auth|api/health|login|_next/static|_next/image|favicon.ico).*)'],
};

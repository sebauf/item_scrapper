/**
 * Toute page exige une session — sauf la page de connexion, les routes
 * d'Auth.js, la sonde de santé et les fichiers statiques (cf. `matcher`).
 *
 * Le filtrage se fait ici, avant tout rendu : une page oubliée ne peut pas
 * s'afficher sans session. La décision elle-même est `authorized` dans
 * `auth.ts` ; refusée, la requête est redirigée vers `/login?callbackUrl=…`.
 *
 * Exceptions de la PWA : `manifest.webmanifest` et `icons/` (tout le dossier
 * `public/icons/`, rien d'autre ne commence ainsi). Le navigateur les
 * télécharge sans cookie de session pour installer l'app ; redirigés vers
 * `/login`, ils feraient échouer l'installation. Ils ne contiennent rien de
 * personnel. Ne pas ajouter ici de préfixe qui couvrirait une page : le
 * `matcher` exclut tout chemin qui *commence* par l'une de ces chaînes.
 *
 * Ce n'est pas la seule barrière : le backend refuse de son côté toute
 * requête sans jeton signé (cf. lib/internal-token.ts).
 */
export { auth as middleware } from '@/auth';

export const config = {
  matcher: ['/((?!api/auth|api/health|login|_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/).*)'],
};

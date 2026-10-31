import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { isEmailAllowed, isProfileAllowed, parseAllowedEmails } from '@/lib/auth-policy';

/**
 * Authentification — Auth.js v5, fournisseur Google uniquement.
 *
 * Variables lues (cf. .env.example) :
 *  - `AUTH_SECRET`        chiffre le cookie de session (JWE) ;
 *  - `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`  client OAuth Google, lus
 *    automatiquement par le fournisseur ;
 *  - `AUTH_ALLOWED_EMAILS` liste blanche facultative (cf. lib/auth-policy.ts) ;
 *  - `AUTH_URL`           URL publique, si elle ne se déduit pas des en-têtes.
 *
 * Session en **JWT** (cookie chiffré), sans base de sessions : le frontend n'a
 * pas de connexion MongoDB et ne doit pas en avoir. Contrepartie : une session
 * ne se révoque pas côté serveur — c'est pourquoi la liste blanche est
 * revérifiée à chaque requête (`authorized`), pas seulement à la connexion.
 *
 * Ce fichier est importé par le middleware, qui tourne sur le runtime Edge :
 * rien de spécifique à Node ici.
 */
const allowedEmails = parseAllowedEmails(process.env.AUTH_ALLOWED_EMAILS);

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: 'jwt' },
  pages: { signIn: '/login', error: '/login' },
  // Derrière l'ingress Traefik, sans host fixe (cf. k8s/base/ingress.yaml) :
  // l'URL de rappel OAuth se déduit de X-Forwarded-Host. Google n'acceptant
  // que les URLs de rappel déclarées dans la console, un hôte forgé ne mène
  // nulle part.
  trustHost: true,
  callbacks: {
    /** À la connexion : adresse vérifiée par Google et présente dans la liste blanche. */
    signIn({ profile }) {
      return isProfileAllowed(profile, allowedEmails);
    },
    /**
     * À chaque requête filtrée par le middleware. `false` renvoie vers
     * `/login`. Retirer une adresse de la liste blanche coupe donc l'accès à la
     * requête suivante, sans attendre l'expiration du cookie (30 jours).
     */
    authorized({ auth }) {
      return isEmailAllowed(auth?.user?.email, allowedEmails);
    },
  },
});

/**
 * La session donne-t-elle encore accès ? Même règle que `authorized`, pour la
 * page de connexion : une session dont l'adresse a été retirée de la liste
 * blanche y est renvoyée par le middleware, et ne doit pas en être aussitôt
 * redirigée vers l'accueil (boucle).
 */
export function hasAccess(email: string | null | undefined): boolean {
  return isEmailAllowed(email, allowedEmails);
}

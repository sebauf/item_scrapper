/**
 * Sonde Kubernetes. Hors du middleware d'authentification (cf. `matcher`) :
 * le kubelet n'a pas de session, et sonder `/` ne mesurerait plus qu'une
 * redirection vers la page de connexion.
 *
 * Ne teste que le processus Next — pas le backend, qui a ses propres sondes :
 * une panne du backend ne doit pas faire redémarrer le frontend en boucle.
 */
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json({ status: 'ok' });
}

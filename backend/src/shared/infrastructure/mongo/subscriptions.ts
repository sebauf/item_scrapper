import { Document } from 'mongodb';

/**
 * Abonnements partagés : `keywords` et `tracked_urls`.
 *
 * Ces deux collections ont deux lecteurs aux besoins différents :
 *  - le **scrapper** veut savoir quoi relever, et lit `enabled: true` — il ne
 *    connaît pas les utilisateurs et n'a pas à les connaître ;
 *  - le **backend** veut savoir qui suit quoi, et lit `subscribers`.
 *
 * Plutôt qu'une collection d'abonnements séparée (que le scrapper devrait
 * joindre), chaque document porte la liste de ses abonnés, et `enabled` en est
 * **dérivé** : vrai tant qu'il reste au moins un abonné. Les deux champs sont
 * écrits dans la même mise à jour — un pipeline d'agrégation passé à
 * `updateOne` —, donc atomiquement au niveau du document : deux utilisateurs qui
 * se désabonnent en même temps ne peuvent pas laisser `enabled: true` sur un
 * mot-clé sans abonné (ni l'inverse).
 *
 * `$ifNull` couvre les documents antérieurs à l'authentification, qui n'ont pas
 * de champ `subscribers`.
 */
export function subscriptionUpdate(userId: string, subscribed: boolean): Document[] {
  const current = { $ifNull: ['$subscribers', []] };
  return [
    {
      $set: {
        subscribers: subscribed
          ? { $setUnion: [current, [userId]] }
          : { $setDifference: [current, [userId]] },
      },
    },
    { $set: { enabled: { $gt: [{ $size: '$subscribers' }, 0] } } },
  ];
}

import { Db } from 'mongodb';
import { UserId } from 'src/shared/domain/user-id';

/**
 * Données antérieures à l'authentification.
 *
 * Avant les comptes Google, il n'existait qu'une liste de mots-clés, de
 * favoris, d'URLs suivies et de stations favorites, commune à tous. Ces
 * documents n'ont pas de propriétaire : sans traitement, plus personne ne les
 * verrait (les mots-clés `enabled: true` continueraient même d'être scrapés,
 * pour personne).
 *
 * Si `AUTH_LEGACY_OWNER_EMAIL` est renseignée, ils sont rattachés à cette
 * adresse au démarrage du backend. C'est **idempotent** : seuls les documents
 * encore sans propriétaire sont touchés, un redémarrage ne refait rien. Un
 * document écrit après l'authentification a toujours un propriétaire (ou un
 * champ `subscribers`, même vide) et n'est donc jamais concerné.
 *
 * Le scrapper amorce aussi trois mots-clés par défaut quand la collection est
 * vide (premier démarrage) : sans abonné, ils deviennent « historiques » au
 * sens de cette fonction, et sont rattachés au prochain démarrage du backend.
 */

/** Documents sans propriétaire, par collection. */
export interface LegacyCounts {
  keywords: number;
  trackedUrls: number;
  favorites: number;
  favoriteStations: number;
}

const NO_SUBSCRIBERS = { subscribers: { $exists: false } };
const NO_OWNER = { userId: { $exists: false } };

/**
 * Un document historique était suivi s'il portait `enabled: true` — c'est le
 * prédicat du scrapper, donc ce qui était réellement relevé. Un document
 * `enabled: false` ou sans `enabled` devient un mot-clé sans abonné.
 * `enabled` est recalculé dans la foulée, comme le fait `subscriptionUpdate`.
 */
function adoptSubscriptions(owner: UserId) {
  return [
    { $set: { subscribers: { $cond: [{ $eq: ['$enabled', true] }, [owner.value], []] } } },
    { $set: { enabled: { $gt: [{ $size: '$subscribers' }, 0] } } },
  ];
}

export async function claimLegacyData(db: Db, owner: UserId): Promise<LegacyCounts> {
  const [keywords, trackedUrls, favorites, favoriteStations] = await Promise.all([
    db.collection('keywords').updateMany(NO_SUBSCRIBERS, adoptSubscriptions(owner)),
    db.collection('tracked_urls').updateMany(NO_SUBSCRIBERS, adoptSubscriptions(owner)),
    db.collection('favorites').updateMany(NO_OWNER, { $set: { userId: owner.value } }),
    // Les stations favorites historiques avaient pour `_id` l'identifiant de
    // la station ; `_id` est immuable, on le recopie dans `stationId`.
    db
      .collection('favorite_stations')
      .updateMany(NO_OWNER, [{ $set: { userId: owner.value, stationId: '$_id' } }]),
  ]);

  return {
    keywords: keywords.modifiedCount,
    trackedUrls: trackedUrls.modifiedCount,
    favorites: favorites.modifiedCount,
    favoriteStations: favoriteStations.modifiedCount,
  };
}

/** Pour l'avertissement de démarrage quand aucun propriétaire n'est configuré. */
export async function countLegacyData(db: Db): Promise<LegacyCounts> {
  const [keywords, trackedUrls, favorites, favoriteStations] = await Promise.all([
    db.collection('keywords').countDocuments(NO_SUBSCRIBERS),
    db.collection('tracked_urls').countDocuments(NO_SUBSCRIBERS),
    db.collection('favorites').countDocuments(NO_OWNER),
    db.collection('favorite_stations').countDocuments(NO_OWNER),
  ]);
  return { keywords, trackedUrls, favorites, favoriteStations };
}

export function totalOf(counts: LegacyCounts): number {
  return counts.keywords + counts.trackedUrls + counts.favorites + counts.favoriteStations;
}

export function describe(counts: LegacyCounts): string {
  return (
    `${counts.keywords} mot(s)-clé(s), ${counts.trackedUrls} URL(s) suivie(s), ` +
    `${counts.favorites} favori(s), ${counts.favoriteStations} station(s) favorite(s)`
  );
}

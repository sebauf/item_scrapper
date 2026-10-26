import { Document } from 'mongodb';
import { MAX_STATIONS, StationSearch } from '../domain/station-search';

/**
 * Pipeline d'agrégation d'une recherche de stations.
 *
 * `$geoNear` doit être le **premier** étage (Mongo le refuse ailleurs) et
 * s'appuie sur l'index 2dsphere `fuel_stations.location` (cf. indexes.ts). Il
 * filtre au rayon, calcule la distance et trie par proximité en une passe.
 *
 * Le filtre carburant entre dans son `query` plutôt que dans un `$match`
 * ultérieur : Mongo l'applique pendant le parcours géographique au lieu de
 * charger puis jeter les stations qui ne le vendent pas.
 *
 * On demande `MAX_STATIONS + 1` documents : le surplus éventuel ne sera pas
 * renvoyé, il sert seulement à savoir que la liste a été coupée.
 */
export function nearStationsPipeline(search: StationSearch): Document[] {
  const stages: Document[] = [
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [search.longitude, search.latitude] },
        key: 'location',
        distanceField: 'distanceMeters',
        maxDistance: search.radiusMeters,
        spherical: true,
        query: search.fuel === null ? {} : { 'fuels.code': search.fuel },
      },
    },
  ];

  if (search.sort === 'price') {
    // Tri sur le carburant demandé seulement. Les stations en rupture passent
    // après les autres, quel que soit leur dernier prix : le moins cher d'une
    // station qui n'en a plus n'aide personne. La distance départage les
    // égalités, fréquentes au millième d'euro près.
    stages.push(
      {
        $addFields: {
          selectedFuel: {
            $arrayElemAt: [
              { $filter: { input: '$fuels', cond: { $eq: ['$$this.code', search.fuel] } } },
              0,
            ],
          },
        },
      },
      { $sort: { 'selectedFuel.available': -1, 'selectedFuel.price': 1, distanceMeters: 1 } },
    );
  }

  stages.push({ $limit: MAX_STATIONS + 1 });
  return stages;
}

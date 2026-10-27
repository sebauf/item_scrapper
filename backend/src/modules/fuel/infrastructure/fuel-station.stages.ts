import { Document } from 'mongodb';
import { MAX_STATIONS, StationSearch } from '../domain/station-search';

/**
 * Pipeline d'agrégation d'une recherche de stations.
 *
 * `$geoNear` doit être le **premier** étage (Mongo le refuse ailleurs) et
 * s'appuie sur l'index 2dsphere `fuel_stations.location` (cf. indexes.ts). Il
 * filtre au rayon, calcule la distance et trie par proximité en une passe.
 *
 * Les filtres carburant et enseigne entrent dans son `query` plutôt que dans
 * un `$match` ultérieur : Mongo les applique pendant le parcours géographique
 * au lieu de charger puis jeter les stations écartées — et le plafond
 * `MAX_STATIONS` s'applique aux stations de l'enseigne, pas avant le filtre.
 *
 * On demande `MAX_STATIONS + 1` documents : le surplus éventuel ne sera pas
 * renvoyé, il sert seulement à savoir que la liste a été coupée.
 */
export function nearStationsPipeline(search: StationSearch): Document[] {
  const query: Document = fuelQuery(search);
  if (search.brand !== null) query.brand = search.brand;
  const stages: Document[] = [geoNear(search, query)];

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

/**
 * Enseignes présentes dans la zone, avec leur nombre de stations — de quoi
 * remplir le sélecteur d'enseigne.
 *
 * Même `$geoNear` que la recherche, filtre carburant compris, mais **sans** le
 * filtre enseigne : sinon, une fois « TotalEnergies » choisie, ce serait la
 * seule enseigne proposée. Pas de plafond : un `$group` sur quelques centaines
 * de stations ne coûte rien. Les stations sans enseigne connue (absentes
 * d'OSM) ne forment pas une enseigne — on ne peut pas filtrer dessus.
 */
export function nearBrandsPipeline(search: StationSearch): Document[] {
  return [
    geoNear(search, fuelQuery(search)),
    { $match: { brand: { $type: 'string' } } },
    { $group: { _id: '$brand', stationCount: { $sum: 1 } } },
  ];
}

function fuelQuery(search: StationSearch): Document {
  return search.fuel === null ? {} : { 'fuels.code': search.fuel };
}

function geoNear(search: StationSearch, query: Document): Document {
  return {
    $geoNear: {
      near: { type: 'Point', coordinates: [search.longitude, search.latitude] },
      key: 'location',
      distanceField: 'distanceMeters',
      maxDistance: search.radiusMeters,
      spherical: true,
      query,
    },
  };
}

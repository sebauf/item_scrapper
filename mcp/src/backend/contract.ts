import type { FuelCode, FuelStationSort, ProductSort } from './client.js';

/**
 * Valeurs admises par le backend, pour les schémas zod des outils : un
 * argument hors liste est refusé avant tout appel réseau, avec un message que
 * l'agent peut lire.
 *
 * Le backend en reste le propriétaire. Chaque liste est confrontée au contrat
 * généré (`api-types.ts`) : une valeur ajoutée ou retirée côté backend, puis
 * `npm run gen:api`, fait échouer le typecheck ici — au lieu d'un outil qui
 * refuserait en silence un carburant que le backend accepte.
 */
export const FUEL_CODES = everyValueOf<FuelCode>()(['gazole', 'e10', 'sp98', 'sp95', 'e85', 'gplc']);
export const PRODUCT_SORTS = everyValueOf<ProductSort>()(['deals', 'price_asc', 'price_desc', 'discount']);
export const FUEL_STATION_SORTS = everyValueOf<FuelStationSort>()(['distance', 'price']);

/**
 * Renvoie `values` tel quel, mais ne compile que si la liste couvre **toute**
 * l'union `Union` — `satisfies` ne vérifierait que l'inclusion. L'erreur de
 * typecheck nomme la valeur manquante (`missing`).
 */
function everyValueOf<Union extends string>() {
  return <const Values extends readonly [Union, ...Union[]]>(
    values: Values &
      ([Exclude<Union, Values[number]>] extends [never]
        ? unknown
        : { missing: Exclude<Union, Values[number]> }),
  ): Values => values;
}

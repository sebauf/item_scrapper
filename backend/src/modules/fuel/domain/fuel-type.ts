/**
 * Carburants publiés par le flux officiel « Prix des carburants ».
 *
 * Les codes sont ceux des colonnes de l'API (`gazole_prix`, `e10_prix`…),
 * repris tels quels par l'import (pipeline/src/fuel/import_stations.py) : un
 * seul vocabulaire de la source jusqu'au frontend. Les libellés affichés
 * (« SP95-E10 »…) sont une affaire de présentation et vivent côté frontend.
 */
export const FUEL_TYPES = ['gazole', 'e10', 'sp98', 'sp95', 'e85', 'gplc'] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export function isFuelType(value: string): value is FuelType {
  return (FUEL_TYPES as readonly string[]).includes(value);
}

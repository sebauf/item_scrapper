import { InvalidStationId } from './fuel.errors';

/**
 * Objet-valeur : identifiant officiel d'un point de vente, tel que le flux
 * « Prix des carburants » le publie (`69003001`) et que l'import le stocke en
 * `_id` de `fuel_stations`.
 *
 * Seuls des chiffres : c'est la forme de tous les identifiants du flux, et
 * l'identifiant voyage dans un chemin d'URL — rien d'autre n'a à y passer.
 */
export class StationId {
  private static readonly PATTERN = /^\d{1,12}$/;

  private constructor(readonly value: string) {}

  static create(raw: unknown): StationId {
    if (typeof raw !== 'string' || !StationId.PATTERN.test(raw)) {
      throw new InvalidStationId('Identifiant de station invalide : attendu une suite de chiffres.');
    }
    return new StationId(raw);
  }
}

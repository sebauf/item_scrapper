export interface FavoriteStationEntry {
  stationId: string;
  addedAt: Date;
}

/**
 * Port de persistance des stations favorites (`favorite_stations`).
 *
 * Même modèle que les produits favoris (cf. favorite/domain) : une simple
 * appartenance à un ensemble, sans agrégat. Ajouter et retirer sont
 * idempotents — c'est un bouton étoile.
 *
 * L'ensemble est aussi lu par le pipeline : l'alerte de réapprovisionnement
 * surveille ces stations (pipeline/src/fuel/restock_alerts.py).
 */
export abstract class FavoriteStationRepository {
  abstract add(stationId: string): Promise<void>;

  abstract remove(stationId: string): Promise<void>;

  /** Triées de la plus récemment ajoutée à la plus ancienne. */
  abstract list(): Promise<FavoriteStationEntry[]>;
}

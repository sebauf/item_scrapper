import { UserId } from 'src/shared/domain/user-id';

export interface FavoriteStationEntry {
  stationId: string;
  addedAt: Date;
}

/**
 * Port de persistance des stations favorites (`favorite_stations`) — un
 * ensemble **par utilisateur**.
 *
 * Même modèle que les produits favoris (cf. favorite/domain) : une simple
 * appartenance à un ensemble, sans agrégat. Ajouter et retirer sont
 * idempotents — c'est un bouton étoile.
 *
 * La collection est aussi lue par le pipeline : l'alerte de
 * réapprovisionnement surveille l'**union** des favorites de tous les
 * utilisateurs (pipeline/src/fuel/restock_alerts.py).
 */
export abstract class FavoriteStationRepository {
  abstract add(owner: UserId, stationId: string): Promise<void>;

  abstract remove(owner: UserId, stationId: string): Promise<void>;

  /** Favorites de `owner`, de la plus récemment ajoutée à la plus ancienne. */
  abstract list(owner: UserId): Promise<FavoriteStationEntry[]>;
}

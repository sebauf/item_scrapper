import { ProductUrlQuotaExceeded } from './product-tracking.errors';

/**
 * Nombre maximal d'URLs qu'un utilisateur peut suivre à l'unité — favoris
 * compris, puisque mettre un produit en favori suit son URL.
 *
 * Même raison que `KeywordQuota` : chaque URL suivie coûte une requête par
 * passage sur un budget de crawl commun. `max = 0` désactive le quota.
 */
export class TrackedUrlQuota {
  constructor(readonly max: number) {}

  assertCanTrackOneMore(currentlyTracked: number): void {
    if (this.max > 0 && currentlyTracked >= this.max) throw new ProductUrlQuotaExceeded(this.max);
  }
}

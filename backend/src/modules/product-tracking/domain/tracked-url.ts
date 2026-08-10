import { ProductUrl } from './product-url';
import { ProductUrlAlreadyTracked } from './product-tracking.errors';

/**
 * Agrégat TrackedUrl — miroir de `keyword/domain/keyword.ts`, mêmes
 * invariants et le même cycle de vie, appliqués à une URL produit plutôt
 * qu'à un terme de recherche.
 *
 *     (inexistant) --track()--> suivie <--retrack()-- non suivie
 *                                 |                      ^
 *                                 +------untrack()-------+
 *
 * En base, « non suivie » correspond à `enabled: false` : on ne supprime
 * jamais la ligne, l'historique de prix scrapé sous cette URL reste
 * exploitable (notamment pour un favori qui referme le suivi ensuite).
 */
export class TrackedUrl {
  private constructor(
    readonly url: ProductUrl,
    private _tracked: boolean,
  ) {}

  static track(url: ProductUrl): TrackedUrl {
    return new TrackedUrl(url, true);
  }

  /** Reconstruit un agrégat depuis la persistance — ne valide aucune règle. */
  static rehydrate(url: ProductUrl, tracked: boolean): TrackedUrl {
    return new TrackedUrl(url, tracked);
  }

  get isTracked(): boolean {
    return this._tracked;
  }

  retrack(): void {
    if (this._tracked) throw new ProductUrlAlreadyTracked(this.url.value);
    this._tracked = true;
  }

  /** Idempotent, comme `Keyword.untrack` — la sémantique attendue d'un DELETE HTTP. */
  untrack(): void {
    this._tracked = false;
  }
}

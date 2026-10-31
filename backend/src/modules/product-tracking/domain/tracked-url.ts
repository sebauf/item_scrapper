import { UserId } from 'src/shared/domain/user-id';
import { ProductUrl } from './product-url';
import { ProductUrlAlreadyTracked } from './product-tracking.errors';

/**
 * Agrégat TrackedUrl — miroir de `keyword/domain/keyword.ts`, mêmes
 * invariants et le même cycle de vie, appliqués à une URL produit plutôt
 * qu'à un terme de recherche, et par utilisateur de la même façon : l'URL est
 * scrapée une fois pour tous, l'abonnement (`owner`) est personnel.
 *
 *     (inexistant) --track()--> suivie <--retrack()-- non suivie
 *                                 |                      ^
 *                                 +------untrack()-------+
 *
 * En base, « non suivie » signifie que `owner` n'est pas parmi les
 * `subscribers` du document ; `enabled` passe à false quand il n'en reste
 * aucun. On ne supprime jamais la ligne, l'historique de prix scrapé sous cette URL reste
 * exploitable (notamment pour un favori qui referme le suivi ensuite).
 */
export class TrackedUrl {
  private constructor(
    readonly owner: UserId,
    readonly url: ProductUrl,
    private _tracked: boolean,
  ) {}

  static track(owner: UserId, url: ProductUrl): TrackedUrl {
    return new TrackedUrl(owner, url, true);
  }

  /** Reconstruit un agrégat depuis la persistance — ne valide aucune règle. */
  static rehydrate(owner: UserId, url: ProductUrl, tracked: boolean): TrackedUrl {
    return new TrackedUrl(owner, url, tracked);
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

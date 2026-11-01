import { UserId } from 'src/shared/domain/user-id';
import { ProductUrl } from './product-url';
import { TrackedUrl } from './tracked-url';

/** Port de persistance de l'agrégat TrackedUrl — miroir de KeywordRepository. */
export abstract class TrackedUrlRepository {
  /**
   * L'URL vue par `owner` : suivie s'il en est abonné, non suivie sinon.
   * `null` seulement si personne n'a jamais suivi cette URL.
   */
  abstract findByUrl(owner: UserId, url: ProductUrl): Promise<TrackedUrl | null>;

  /** Nombre d'URLs que suit `owner` — pour le quota. */
  abstract countTrackedBy(owner: UserId): Promise<number>;

  /** Persiste l'abonnement de `tracked.owner`, sans toucher à ceux des autres. */
  abstract save(tracked: TrackedUrl): Promise<void>;
}

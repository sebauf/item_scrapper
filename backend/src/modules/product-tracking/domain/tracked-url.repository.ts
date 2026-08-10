import { ProductUrl } from './product-url';
import { TrackedUrl } from './tracked-url';

/** Port de persistance de l'agrégat TrackedUrl — miroir de KeywordRepository. */
export abstract class TrackedUrlRepository {
  abstract findByUrl(url: ProductUrl): Promise<TrackedUrl | null>;

  abstract save(tracked: TrackedUrl): Promise<void>;
}

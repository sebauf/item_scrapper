import { ProductUrl } from '../domain/product-url';
import { TrackedUrl } from '../domain/tracked-url';
import { TrackedUrlRepository } from '../domain/tracked-url.repository';

/** Double de test du port de persistance — miroir de InMemoryKeywordRepository. */
export class InMemoryTrackedUrlRepository extends TrackedUrlRepository {
  private readonly store = new Map<string, boolean>();

  constructor(initial: Record<string, boolean> = {}) {
    super();
    for (const [url, tracked] of Object.entries(initial)) this.store.set(url, tracked);
  }

  findByUrl(url: ProductUrl): Promise<TrackedUrl | null> {
    const tracked = this.store.get(url.value);
    return Promise.resolve(tracked === undefined ? null : TrackedUrl.rehydrate(url, tracked));
  }

  save(tracked: TrackedUrl): Promise<void> {
    this.store.set(tracked.url.value, tracked.isTracked);
    return Promise.resolve();
  }

  /** Helper d'assertion : état persisté d'une URL. */
  stateOf(url: string): boolean | undefined {
    return this.store.get(url);
  }
}

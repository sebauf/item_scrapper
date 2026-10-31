import { UserId } from 'src/shared/domain/user-id';
import { ProductUrl } from '../domain/product-url';
import { TrackedUrl } from '../domain/tracked-url';
import { TrackedUrlRepository } from '../domain/tracked-url.repository';

/** Double de test du port de persistance — miroir de InMemoryKeywordRepository. */
export class InMemoryTrackedUrlRepository extends TrackedUrlRepository {
  private readonly store = new Map<string, Set<string>>();

  /** `initial` : URL → adresses de ses abonnés. */
  constructor(initial: Record<string, string[]> = {}) {
    super();
    for (const [url, subscribers] of Object.entries(initial)) this.store.set(url, new Set(subscribers));
  }

  findByUrl(owner: UserId, url: ProductUrl): Promise<TrackedUrl | null> {
    const subscribers = this.store.get(url.value);
    return Promise.resolve(
      subscribers === undefined ? null : TrackedUrl.rehydrate(owner, url, subscribers.has(owner.value)),
    );
  }

  save(tracked: TrackedUrl): Promise<void> {
    const subscribers = this.store.get(tracked.url.value) ?? new Set<string>();
    if (tracked.isTracked) subscribers.add(tracked.owner.value);
    else subscribers.delete(tracked.owner.value);
    this.store.set(tracked.url.value, subscribers);
    return Promise.resolve();
  }

  /** Helper d'assertion : abonnés persistés d'une URL, triés ; `undefined` si inconnue. */
  subscribersOf(url: string): string[] | undefined {
    const subscribers = this.store.get(url);
    return subscribers === undefined ? undefined : [...subscribers].sort();
  }
}

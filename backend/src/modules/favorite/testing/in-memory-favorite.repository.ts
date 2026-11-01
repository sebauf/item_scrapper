import { UserId } from 'src/shared/domain/user-id';
import { FavoriteEntry, FavoriteRepository } from '../domain/favorite.repository';

const DEFAULT_OWNER = 'alice@example.com';

export class InMemoryFavoriteRepository extends FavoriteRepository {
  /** utilisateur → (url → date d'ajout) */
  private readonly store = new Map<string, Map<string, Date>>();

  /** `initial` : favoris de `owner` (Alice par défaut, l'utilisateur des tests d'API). */
  constructor(initial: Record<string, Date> = {}, owner: string = DEFAULT_OWNER) {
    super();
    for (const [url, addedAt] of Object.entries(initial)) this.bucket(owner).set(url, addedAt);
  }

  private bucket(owner: string): Map<string, Date> {
    let bucket = this.store.get(owner);
    if (!bucket) {
      bucket = new Map();
      this.store.set(owner, bucket);
    }
    return bucket;
  }

  add(owner: UserId, url: string): Promise<void> {
    const bucket = this.bucket(owner.value);
    if (!bucket.has(url)) bucket.set(url, new Date());
    return Promise.resolve();
  }

  remove(owner: UserId, url: string): Promise<void> {
    this.bucket(owner.value).delete(url);
    return Promise.resolve();
  }

  isFavorite(owner: UserId, url: string): Promise<boolean> {
    return Promise.resolve(this.bucket(owner.value).has(url));
  }

  list(owner: UserId): Promise<FavoriteEntry[]> {
    const entries = Array.from(this.bucket(owner.value).entries())
      .map(([url, addedAt]) => ({ url, addedAt }))
      .sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime());
    return Promise.resolve(entries);
  }
}

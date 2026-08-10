import { FavoriteEntry, FavoriteRepository } from '../domain/favorite.repository';

export class InMemoryFavoriteRepository extends FavoriteRepository {
  private readonly store = new Map<string, Date>();

  constructor(initial: Record<string, Date> = {}) {
    super();
    for (const [url, addedAt] of Object.entries(initial)) this.store.set(url, addedAt);
  }

  add(url: string): Promise<void> {
    if (!this.store.has(url)) this.store.set(url, new Date());
    return Promise.resolve();
  }

  remove(url: string): Promise<void> {
    this.store.delete(url);
    return Promise.resolve();
  }

  isFavorite(url: string): Promise<boolean> {
    return Promise.resolve(this.store.has(url));
  }

  list(): Promise<FavoriteEntry[]> {
    const entries = Array.from(this.store.entries())
      .map(([url, addedAt]) => ({ url, addedAt }))
      .sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime());
    return Promise.resolve(entries);
  }
}

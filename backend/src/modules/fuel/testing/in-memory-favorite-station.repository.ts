import {
  FavoriteStationEntry,
  FavoriteStationRepository,
} from '../domain/favorite-station.repository';

export class InMemoryFavoriteStationRepository extends FavoriteStationRepository {
  private readonly store = new Map<string, Date>();

  constructor(initial: Record<string, Date> = {}) {
    super();
    for (const [stationId, addedAt] of Object.entries(initial)) this.store.set(stationId, addedAt);
  }

  add(stationId: string): Promise<void> {
    if (!this.store.has(stationId)) this.store.set(stationId, new Date());
    return Promise.resolve();
  }

  remove(stationId: string): Promise<void> {
    this.store.delete(stationId);
    return Promise.resolve();
  }

  list(): Promise<FavoriteStationEntry[]> {
    const entries = Array.from(this.store.entries())
      .map(([stationId, addedAt]) => ({ stationId, addedAt }))
      .sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime());
    return Promise.resolve(entries);
  }
}

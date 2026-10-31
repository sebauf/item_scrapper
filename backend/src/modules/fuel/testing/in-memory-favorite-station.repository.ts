import { UserId } from 'src/shared/domain/user-id';
import {
  FavoriteStationEntry,
  FavoriteStationRepository,
} from '../domain/favorite-station.repository';

const DEFAULT_OWNER = 'alice@example.com';

export class InMemoryFavoriteStationRepository extends FavoriteStationRepository {
  /** utilisateur → (station → date d'ajout) */
  private readonly store = new Map<string, Map<string, Date>>();

  /** `initial` : favorites de `owner` (Alice par défaut, l'utilisateur des tests d'API). */
  constructor(initial: Record<string, Date> = {}, owner: string = DEFAULT_OWNER) {
    super();
    for (const [stationId, addedAt] of Object.entries(initial)) this.bucket(owner).set(stationId, addedAt);
  }

  private bucket(owner: string): Map<string, Date> {
    let bucket = this.store.get(owner);
    if (!bucket) {
      bucket = new Map();
      this.store.set(owner, bucket);
    }
    return bucket;
  }

  add(owner: UserId, stationId: string): Promise<void> {
    const bucket = this.bucket(owner.value);
    if (!bucket.has(stationId)) bucket.set(stationId, new Date());
    return Promise.resolve();
  }

  remove(owner: UserId, stationId: string): Promise<void> {
    this.bucket(owner.value).delete(stationId);
    return Promise.resolve();
  }

  list(owner: UserId): Promise<FavoriteStationEntry[]> {
    const entries = Array.from(this.bucket(owner.value).entries())
      .map(([stationId, addedAt]) => ({ stationId, addedAt }))
      .sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime());
    return Promise.resolve(entries);
  }
}

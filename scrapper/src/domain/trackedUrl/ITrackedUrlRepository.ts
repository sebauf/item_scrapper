import type { TrackedUrl } from './TrackedUrl.js';

export interface ITrackedUrlRepository {
  findEnabled(): Promise<TrackedUrl[]>;
}

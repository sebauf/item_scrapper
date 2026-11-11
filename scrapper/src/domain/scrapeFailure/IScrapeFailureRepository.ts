import type { ScrapeFailure } from './ScrapeFailure.js';

export interface IScrapeFailureRepository {
  record(failure: ScrapeFailure): Promise<void>;
}

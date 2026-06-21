import type { Keyword } from './Keyword.js';

export interface IKeywordRepository {
  findEnabled(): Promise<Keyword[]>;
  seedDefaults(keywords: readonly Keyword[]): Promise<void>;
}

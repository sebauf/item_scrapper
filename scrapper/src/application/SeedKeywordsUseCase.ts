import type { IKeywordRepository } from '../domain/keyword/IKeywordRepository.js';
import type { Keyword } from '../domain/keyword/Keyword.js';

export class SeedKeywordsUseCase {
  constructor(private readonly keywordRepository: IKeywordRepository) {}

  async execute(defaults: readonly Keyword[]): Promise<void> {
    await this.keywordRepository.seedDefaults(defaults);
  }
}

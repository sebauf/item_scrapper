import { Injectable } from '@nestjs/common';
import { KeywordName } from '../../domain/keyword-name';
import { KeywordNotFound } from '../../domain/keyword.errors';
import { KeywordRepository } from '../../domain/keyword.repository';

/**
 * Retire un mot-clé du suivi.
 *
 * Remplace frontend/src/app/actions.ts:deleteKeyword, avec une différence
 * assumée : l'ancienne version ignorait silencieusement un mot-clé inexistant.
 * Ici on lève KeywordNotFound (→ 404), pour qu'un appel erroné du frontend soit
 * visible au lieu de passer pour un succès. Retirer un mot-clé *déjà* retiré
 * reste, lui, un succès (cf. Keyword.untrack).
 */
@Injectable()
export class UntrackKeywordCommand {
  constructor(private readonly keywords: KeywordRepository) {}

  async execute(rawName: unknown): Promise<void> {
    const name = KeywordName.create(rawName);
    const existing = await this.keywords.findByName(name);

    if (existing === null) throw new KeywordNotFound(name.value);

    existing.untrack();
    await this.keywords.save(existing);
  }
}

import { Injectable } from '@nestjs/common';
import { Keyword } from '../../domain/keyword';
import { KeywordName } from '../../domain/keyword-name';
import { KeywordRepository } from '../../domain/keyword.repository';

/**
 * Commande — côté écriture du CQRS : elle modifie l'état et ne renvoie rien.
 *
 * Elle ne contient aucune règle métier : elle orchestre. Les règles sont dans
 * `KeywordName.create` (validité du nom) et `Keyword.retrack` (transition
 * autorisée ou non). C'est ce qui permet de les tester sans base ni HTTP.
 *
 * Remplace frontend/src/app/actions.ts:addKeyword.
 */
@Injectable()
export class TrackKeywordCommand {
  constructor(private readonly keywords: KeywordRepository) {}

  async execute(rawName: unknown): Promise<void> {
    const name = KeywordName.create(rawName);
    const existing = await this.keywords.findByName(name);

    if (existing === null) {
      await this.keywords.save(Keyword.track(name));
      return;
    }

    existing.retrack(); // lève KeywordAlreadyTracked s'il est déjà suivi
    await this.keywords.save(existing);
  }
}

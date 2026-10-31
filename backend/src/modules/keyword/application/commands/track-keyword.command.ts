import { Injectable } from '@nestjs/common';
import { UserId } from 'src/shared/domain/user-id';
import { Keyword } from '../../domain/keyword';
import { KeywordName } from '../../domain/keyword-name';
import { KeywordRepository } from '../../domain/keyword.repository';

/**
 * Commande — côté écriture du CQRS : elle modifie l'état et ne renvoie rien.
 *
 * Elle ne contient aucune règle métier : elle orchestre. Les règles sont dans
 * `KeywordName.create` (validité du nom) et `Keyword.retrack` (transition
 * autorisée ou non). C'est ce qui permet de les tester sans base ni HTTP.
 */
@Injectable()
export class TrackKeywordCommand {
  constructor(private readonly keywords: KeywordRepository) {}

  async execute(owner: UserId, rawName: unknown): Promise<void> {
    const name = KeywordName.create(rawName);
    const existing = await this.keywords.findByName(owner, name);

    if (existing === null) {
      await this.keywords.save(Keyword.track(owner, name));
      return;
    }

    existing.retrack(); // lève KeywordAlreadyTracked si `owner` le suit déjà
    await this.keywords.save(existing);
  }
}

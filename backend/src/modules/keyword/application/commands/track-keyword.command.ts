import { Injectable } from '@nestjs/common';
import { UserId } from 'src/shared/domain/user-id';
import { Keyword } from '../../domain/keyword';
import { KeywordName } from '../../domain/keyword-name';
import { KeywordQuota } from '../../domain/keyword-quota';
import { KeywordRepository } from '../../domain/keyword.repository';

/**
 * Commande — côté écriture du CQRS : elle modifie l'état et ne renvoie rien.
 *
 * Elle ne contient aucune règle métier : elle orchestre. Les règles sont dans
 * `KeywordName.create` (validité du nom), `Keyword.retrack` (transition
 * autorisée ou non) et `KeywordQuota` (plafond par utilisateur). C'est ce qui
 * permet de les tester sans base ni HTTP.
 *
 * Ordre des refus : « déjà suivi » (409) passe avant le quota — redemander un
 * mot-clé qu'on suit déjà ne doit pas être présenté comme un dépassement.
 *
 * Le comptage et l'écriture ne sont pas atomiques : deux ajouts simultanés
 * du même utilisateur, au plafond moins un, peuvent tous deux passer. Le
 * dépassement est d'un abonnement au plus, et il faut le provoquer exprès ; ça
 * ne justifie pas une transaction.
 */
@Injectable()
export class TrackKeywordCommand {
  constructor(
    private readonly keywords: KeywordRepository,
    private readonly quota: KeywordQuota,
  ) {}

  async execute(owner: UserId, rawName: unknown): Promise<void> {
    const name = KeywordName.create(rawName);
    const existing = await this.keywords.findByName(owner, name);

    const keyword = existing ?? Keyword.track(owner, name);
    if (existing !== null) existing.retrack(); // lève KeywordAlreadyTracked si `owner` le suit déjà

    this.quota.assertCanTrackOneMore(await this.keywords.countTrackedBy(owner));
    await this.keywords.save(keyword);
  }
}

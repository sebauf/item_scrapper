import { Injectable } from '@nestjs/common';
import { UserId } from 'src/shared/domain/user-id';
import { KeywordSummary, KeywordSummaryReadModel } from '../ports/keyword-summary.read-model';

/**
 * Requête — côté lecture : ne modifie rien, renvoie des données d'affichage.
 *
 * Volontairement une simple délégation aujourd'hui. Elle existe quand même pour
 * que le controller dépende de la couche application et jamais directement d'un
 * read model : le jour où il faut un tri, un cache ou un filtre, ça se pose ici
 * sans toucher ni au HTTP ni à Mongo.
 */
@Injectable()
export class ListKeywordSummariesQuery {
  constructor(private readonly readModel: KeywordSummaryReadModel) {}

  execute(owner: UserId): Promise<KeywordSummary[]> {
    return this.readModel.listTracked(owner);
  }
}

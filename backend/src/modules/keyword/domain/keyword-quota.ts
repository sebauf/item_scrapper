import { KeywordQuotaExceeded } from './keyword.errors';

/**
 * Nombre maximal de mots-clés qu'un utilisateur peut suivre.
 *
 * Pourquoi un quota : le budget de crawl est **commun** à tous les comptes
 * (`MAX_REQUESTS_PER_CRAWL`, 1000 requêtes par passage). Un mot-clé en coûte
 * jusqu'à ~155 (5 pages de recherche + `KNOWN_PRODUCTS_LIMIT_PER_KEYWORD` = 150
 * relectures). Sans plafond, un seul compte autorisé pourrait épuiser le budget
 * et, par la règle de fraîcheur, faire disparaître les produits des autres.
 *
 * Le quota compte les **abonnements** de l'utilisateur, pas le coût réel :
 * suivre un mot-clé qu'un autre suit déjà ne coûte rien au crawl, mais compte
 * quand même. C'est voulu : la règle reste lisible (« 10 mots-clés par
 * personne ») et ne dépend pas de ce que font les autres.
 *
 * `max = 0` désactive le quota.
 */
export class KeywordQuota {
  constructor(readonly max: number) {}

  /** Lève `KeywordQuotaExceeded` si un abonnement de plus dépasserait le quota. */
  assertCanTrackOneMore(currentlyTracked: number): void {
    if (this.max > 0 && currentlyTracked >= this.max) throw new KeywordQuotaExceeded(this.max);
  }
}

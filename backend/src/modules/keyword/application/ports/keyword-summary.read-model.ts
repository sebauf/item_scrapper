/**
 * Côté lecture du CQRS.
 *
 * Ce port ne renvoie **pas** d'agrégats `Keyword` mais des structures plates
 * taillées pour l'écran « mots-clés suivis ». C'est délibéré : `productCount`
 * et `lastScrape` sont calculés à partir de `items_raw`, une collection
 * alimentée par le scrapper que le backend ne modifie jamais. Il n'y a donc
 * aucun invariant à protéger, et charger un agrégat pour afficher un compteur
 * ne ferait qu'ajouter des allers-retours.
 */
export interface KeywordSummary {
  keyword: string;
  productCount: number;
  /** ISO 8601, ou null si le mot-clé n'a jamais rien remonté. */
  lastScrape: string | null;
}

export abstract class KeywordSummaryReadModel {
  abstract listTracked(): Promise<KeywordSummary[]>;
}

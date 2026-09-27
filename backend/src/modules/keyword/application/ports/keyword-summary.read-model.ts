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

  /**
   * Les mots-clés que `listTracked` renverrait, réduits à leurs noms.
   *
   * Existe pour que le tableau de bord (contexte Catalog) ne réinvente pas la
   * règle. Il lui en faut deux usages, et c'est pour ça que ce port renvoie les
   * noms plutôt qu'un nombre : son compteur (qui comptait les documents
   * `enabled: true`, ignorant les mots-clés hérités sans document) et le choix
   * des blocs « bonnes affaires par mot-clé » (qui partait d'`items_raw`, donc
   * affichait encore les mots-clés retirés). Deux requêtes distinctes seraient
   * deux occasions de divergence.
   *
   * Moins cher que `listTracked` : ni comptage de produits, ni `$max` sur
   * `scrapedAt`, dont le tableau de bord n'a que faire.
   */
  abstract listTrackedNames(): Promise<string[]>;
}

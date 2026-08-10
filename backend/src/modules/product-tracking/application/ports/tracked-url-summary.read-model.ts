/**
 * Côté lecture du CQRS — miroir de KeywordSummaryReadModel.
 *
 * `title`, `image`, `price` et `lastScrape` viennent de `items_raw` (dernier
 * relevé du scrapper) : `null` tant qu'une URL suivie n'a pas encore été
 * scrapée une première fois.
 */
export interface TrackedUrlSummary {
  /** Identifiant encodé, directement utilisable dans /products/{id} et /product/{id}. */
  id: string;
  url: string;
  title: string | null;
  image: string | null;
  price: { amount: number; currency: string } | null;
  /** ISO 8601, ou null si l'URL n'a jamais encore été scrapée. */
  lastScrape: string | null;
}

export abstract class TrackedUrlSummaryReadModel {
  abstract listTracked(): Promise<TrackedUrlSummary[]>;
}

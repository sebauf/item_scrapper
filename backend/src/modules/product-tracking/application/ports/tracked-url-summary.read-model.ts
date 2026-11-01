import { UserId } from 'src/shared/domain/user-id';

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
  /** Les URLs que suit `owner` — et seulement elles. */
  abstract listTracked(owner: UserId): Promise<TrackedUrlSummary[]>;

  /**
   * Les mêmes URLs, réduites à leur valeur canonique. Sert le tableau de bord
   * (contexte Catalog), dont les compteurs portent sur le périmètre de
   * l'utilisateur : ses mots-clés **et** ses URLs suivies à l'unité.
   */
  abstract listTrackedUrls(owner: UserId): Promise<string[]>;
}

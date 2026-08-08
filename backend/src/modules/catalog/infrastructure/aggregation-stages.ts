import { Document } from 'mongodb';
import { DEAL_SCORE_THRESHOLD } from '../domain/deal-policy';

/**
 * Étages « dernier relevé par produit » sur `items_raw`.
 *
 * `items_raw` contient un document par (url, jour) : il faut donc réduire à la
 * ligne la plus récente de chaque URL avant toute autre opération. `scrapedAt`
 * départage deux scrapes d'un même jour, sans quoi la pagination pourrait
 * renvoyer deux fois le même produit d'une page à l'autre.
 *
 * Le dernier $match écarte les produits inexploitables (titre vide, prix
 * absent) : ils fausseraient les compteurs affichés.
 */
export function latestPerUrlStages(match: Document): Document[] {
  return [
    { $match: match },
    { $sort: { day: -1, scrapedAt: -1 } },
    { $group: { _id: '$url', doc: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$doc' } },
    { $match: { title: { $ne: '' }, price: { $ne: null } } },
  ];
}

/**
 * Jointure à gauche avec `deal_scores` (clé = url), puis calcul des champs
 * dérivés nécessaires au tri et au filtrage.
 *
 * Le `$first` sur le tableau du $lookup est ce qui rend la jointure « à
 * gauche » : un produit sans score survit avec `isDeal: false`, au lieu d'être
 * éliminé par un $unwind.
 *
 * `sortScore` retombe sur -1 pour que les produits non scorés se rangent après
 * les autres sans jamais être confondus avec un score nul.
 */
export function withDealScoreStages(): Document[] {
  return [
    {
      $lookup: {
        from: 'deal_scores',
        localField: 'url',
        foreignField: '_id',
        as: 'scoreDoc',
      },
    },
    { $addFields: { scoreDoc: { $first: '$scoreDoc' } } },
    {
      $addFields: {
        dealScore: '$scoreDoc.score',
        predictedPrice: '$scoreDoc.predictedPrice',
        trendDirection: '$scoreDoc.trendDirection',
        isDeal: { $gte: [{ $ifNull: ['$scoreDoc.score', -1] }, DEAL_SCORE_THRESHOLD] },
        sortScore: { $ifNull: ['$scoreDoc.score', -1] },
        discountRatio: {
          $cond: [
            {
              $and: [{ $gt: ['$crossedOutPrice.amount', 0] }, { $gt: ['$price.amount', 0] }],
            },
            { $subtract: [1, { $divide: ['$price.amount', '$crossedOutPrice.amount'] }] },
            0,
          ],
        },
      },
    },
    { $project: { scoreDoc: 0 } },
  ];
}

/** Neutralise les métacaractères d'une saisie utilisateur avant $regex. */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

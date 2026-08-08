import type {
  Dashboard,
  KeywordSummary,
  Money,
  PriceHistoryEntry,
  ProductDetail,
  ProductSearchResult,
  ProductSummary,
  UnitPrice,
} from './backend/client.js';

/**
 * Mise en forme des réponses de l'API pour un lecteur qui est un modèle.
 *
 * Un outil MCP pourrait renvoyer le JSON brut, mais celui du backend est taillé
 * pour une interface graphique : tableaux d'images, URLs complètes, champs
 * répétés. On rend donc du texte compact, en gardant systématiquement l'`id`
 * opaque — c'est la seule clé qui permet ensuite d'appeler `get_product`.
 *
 * Les champs de scoring valent `null` quand ils manquent (jamais `undefined`),
 * d'où les tests `!== null`.
 */

export function formatMoney(money: Money | null): string {
  return money === null ? 'prix inconnu' : `${money.amount.toFixed(2)} ${money.currency}`;
}

export function formatUnitPrice(unitPrice: UnitPrice | null): string | null {
  return unitPrice === null ? null : `${unitPrice.amount.toFixed(2)}/${unitPrice.unit}`;
}

/** Date ISO → `2026-08-08`, la partie horaire n'apporte rien à l'agent. */
export function formatDay(iso: string | null): string {
  return iso === null ? 'jamais' : iso.slice(0, 10);
}

function formatScoring(product: ProductSummary): string {
  if (product.dealScore === null) return 'pas encore de score (historique insuffisant)';

  const parts = [
    `${product.isDeal ? 'BONNE AFFAIRE' : 'pas une affaire'}`,
    `écart ${product.dealScore > 0 ? '+' : ''}${product.dealScore.toFixed(1)}% vs prix attendu`,
  ];
  if (product.predictedPrice !== null) {
    parts.push(`attendu ${product.predictedPrice.toFixed(2)}`);
  }
  if (product.trendDirection !== null) {
    parts.push(`tendance ${product.trendDirection}`);
  }
  return parts.join(', ');
}

export function formatProductSummary(product: ProductSummary): string {
  const price = [formatMoney(product.price)];
  if (product.crossedOutPrice !== null) {
    price.push(`barré ${formatMoney(product.crossedOutPrice)}`);
  }
  const unit = formatUnitPrice(product.unitPrice);
  if (unit !== null) price.push(unit);

  const lines = [
    `- ${product.title}`,
    `  id: ${product.id}`,
    `  prix: ${price.join(' | ')}`,
    `  ${formatScoring(product)}`,
    `  boutique: ${product.shop} | relevé le ${formatDay(product.scrapedAt)}`,
  ];
  if (product.deliveryDate !== null) lines.push(`  livraison: ${product.deliveryDate}`);
  lines.push(`  url: ${product.url}`);
  return lines.join('\n');
}

/**
 * L'historique complet peut compter des centaines de jours. On en renvoie les
 * `limit` derniers, du plus récent au plus ancien : au-delà, l'agent paie des
 * jetons pour une série qu'il n'utilisera pas.
 */
export function formatHistory(history: PriceHistoryEntry[], limit: number): string {
  if (history.length === 0) return 'Aucun historique de prix.';

  const recent = [...history].sort((a, b) => b.day.localeCompare(a.day)).slice(0, limit);
  const rows = recent.map((entry) => `  ${formatDay(entry.day)} : ${formatMoney(entry.price)}`);
  const omitted = history.length - recent.length;

  return [
    `Historique de prix (${history.length} relevé${history.length > 1 ? 's' : ''}${
      omitted > 0 ? `, les ${recent.length} plus récents affichés` : ''
    }) :`,
    ...rows,
  ].join('\n');
}

export function formatProductDetail(product: ProductDetail, historyLimit: number): string {
  return [
    formatProductSummary(product),
    `  suivi du ${formatDay(product.firstSeen)} au ${formatDay(product.lastSeen)}`,
    '',
    formatHistory(product.history, historyLimit),
  ].join('\n');
}

export function formatKeywordSummaries(summaries: KeywordSummary[]): string {
  if (summaries.length === 0) {
    return 'Aucun mot-clé suivi. Utiliser track_keyword pour en ajouter un.';
  }
  const rows = summaries.map(
    (summary) =>
      `- ${summary.keyword} : ${summary.productCount} produit(s), dernier scrape ${formatDay(summary.lastScrape)}`,
  );
  return [`${summaries.length} mot(s)-clé(s) suivi(s) :`, ...rows].join('\n');
}

export function formatSearchResult(
  keyword: string,
  result: ProductSearchResult,
  page: number,
): string {
  const header =
    `Mot-clé « ${keyword} » : ${result.keywordTotal} produit(s) suivis dont ` +
    `${result.keywordDealCount} bonne(s) affaire(s).\n` +
    `Filtres appliqués : ${result.total} résultat(s), page ${page}/${Math.max(result.pageCount, 1)}.`;

  if (result.items.length === 0) {
    return `${header}\nAucun produit sur cette page.`;
  }
  return [header, '', ...result.items.map(formatProductSummary)].join('\n');
}

export function formatDashboard(dashboard: Dashboard): string {
  const header = [
    `Mots-clés suivis : ${dashboard.keywordCount}`,
    `Produits suivis : ${dashboard.productCount}`,
    `Bonnes affaires du moment : ${dashboard.dealCount}`,
    `Dernière mise à jour du pipeline : ${formatDay(dashboard.lastUpdate)}`,
  ].join('\n');

  if (dashboard.dealsByKeyword.length === 0) {
    return `${header}\n\nAucune bonne affaire à signaler.`;
  }

  const blocks = dashboard.dealsByKeyword.map((entry) => {
    const title = `## ${entry.keyword} — ${entry.totalDeals} affaire(s) sur ${entry.productCount} produit(s)`;
    if (entry.deals.length === 0) return `${title}\n(aucune affaire en tête)`;
    return [title, ...entry.deals.map(formatProductSummary)].join('\n');
  });

  return [header, '', 'Meilleures affaires par mot-clé :', '', ...blocks].join('\n');
}

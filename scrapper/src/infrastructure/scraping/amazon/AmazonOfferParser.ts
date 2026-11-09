/**
 * Règles pures de lecture de l'offre d'une fiche Amazon : la fiche
 * propose-t-elle encore l'article, et quel prix lui appartient vraiment.
 *
 * Le piège que ce module existe pour éviter : sur une fiche « Actuellement
 * indisponible », Amazon remplit la page d'articles de remplacement
 * (« Articles similaires », « Options d'achat similaires »…), chacun avec
 * son prix. Un sélecteur générique comme `.a-price .a-offscreen` lit alors
 * le prix du premier remplaçant et l'attribue à l'article indisponible —
 * historique faussé, et un écart de prix qui peut passer pour une bonne
 * affaire.
 */

/**
 * Conteneurs du prix de l'article lui-même, mises en page récente (« apex »)
 * et ancienne (« corePrice »). Le prix n'est cherché **que** dedans : un prix
 * hors de ces blocs appartient à un autre article (carrousels, remplaçants,
 * publicités).
 */
export const OWN_PRICE_CONTAINERS = [
  '#apex_desktop',
  '#apex_offerDisplay_desktop',
  '#corePriceDisplay_desktop_feature_div',
  '#corePrice_desktop',
  '#corePrice_feature_div',
] as const;

/** Sélecteurs du prix, par ordre de confiance, chacun restreint aux conteneurs ci-dessus. */
export const OWN_PRICE_SELECTORS = [
  scoped('.apex-pricetopay-value .a-offscreen'),
  scoped('.priceToPay .a-offscreen'),
  scoped('.a-price .a-offscreen'),
] as const;

/** Blocs où Amazon écrit l'état de stock de l'article. */
export const AVAILABILITY_SELECTOR =
  '#availability, #availability_feature_div, #outOfStock, #outOfStock_feature_div';

/**
 * Libellés d'une fiche sans offre : « Actuellement indisponible. »
 * (« Currently unavailable. » en anglais).
 *
 * Volontairement **sans** « rupture de stock » : « Temporairement en rupture
 * de stock. Commandez maintenant… » reste une offre achetable, à son vrai
 * prix. Ni « Disponible auprès de ces vendeurs » : l'article est vendu par
 * des tiers, son prix est simplement absent du bloc principal (et donc lu
 * `null`, ce qui est juste).
 */
const UNAVAILABLE_PATTERN = /\bindisponible\b|\bunavailable\b/i;

function scoped(selector: string): string {
  return OWN_PRICE_CONTAINERS.map((container) => `${container} ${selector}`).join(', ');
}

/** Vrai si le texte de disponibilité de la fiche annonce qu'elle n'a plus d'offre. */
export function isUnavailable(availabilityText: string | null): boolean {
  if (!availabilityText) return false;
  return UNAVAILABLE_PATTERN.test(availabilityText.replace(/\s+/g, ' '));
}

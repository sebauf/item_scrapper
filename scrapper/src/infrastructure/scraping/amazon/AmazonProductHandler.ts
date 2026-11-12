import type { PlaywrightCrawlingContext } from 'crawlee';
import type { IProductRepository } from '../../../domain/product/IProductRepository.js';
import type { Product } from '../../../domain/product/Product.js';
import { parsePrice, parseUnitPrice } from './PriceParser.js';
import { extractAmazonIdentity, type ExtractedIdentity } from './AmazonIdentityExtractor.js';
import { isUnavailable } from './AmazonOfferParser.js';
import { asinOf, isDeadProductRedirect } from './AmazonUrl.js';
import {
  extractAvailabilityText,
  extractOfferTexts,
  extractTitle,
  extractVariantUrls,
  hasAnyPrice,
  simulateHumanScroll,
  type OfferTexts,
} from './AmazonProductPage.js';

export const AMAZON_SHOP = 'amazon';

type Log = PlaywrightCrawlingContext['log'];

/**
 * Une fiche produit, dans cet ordre : fiche disparue ? page lisible ? offre
 * encore proposée ? Puis le relevé, et les déclinaisons à visiter.
 */
export function createAmazonProductHandler(
  productRepository: IProductRepository,
): (context: PlaywrightCrawlingContext) => Promise<void> {
  return async (context) => {
    const { page, request, log } = context;
    await simulateHumanScroll(page);

    if (isDeadProductRedirect(request.url, page.url())) {
      log.info(`Dead product (redirected away), marking unavailable`, {
        url: request.url,
        finalUrl: page.url(),
      });
      await productRepository.markUnavailable(request.url);
      return;
    }

    const title = await extractTitle(page);
    if (!title) {
      log.warning('Skipped save: page failed to extract a title (likely blocked or unavailable)', {
        url: request.url,
      });
      return;
    }

    // La disponibilité se juge avant le prix : une fiche « Actuellement
    // indisponible » affiche des articles de remplacement avec leurs prix,
    // et aucun d'eux n'est le prix de cet article. Même traitement qu'une
    // fiche redirigée — plus scorée, historique conservé, drapeau levé au
    // prochain passage réussi.
    const availabilityText = await extractAvailabilityText(page);
    if (isUnavailable(availabilityText)) {
      log.info('Product currently unavailable, marking unavailable (no price recorded)', {
        url: request.url,
        availability: availabilityText,
      });
      await productRepository.markUnavailable(request.url);
    } else {
      await productRepository.save(await readProduct(context, title, availabilityText));
    }

    await enqueueVariants(context);
  };
}

async function readProduct(
  { page, request, log }: PlaywrightCrawlingContext,
  title: string,
  availabilityText: string | null,
): Promise<Product> {
  const offer = await extractOfferTexts(page);
  const identity = await extractAmazonIdentity(page, title);

  log.info(`Scraped: ${title} — ${offer.priceText ?? 'no price'}`, {
    url: request.url,
    ean: identity.ean,
    eanSource: identity.eanSource,
  });

  // Garde-fou contre une refonte d'Amazon : si la page montre des prix mais
  // qu'aucun n'est dans les blocs de l'article, soit l'article n'a pas
  // d'offre principale (vendu par des tiers), soit nos sélecteurs sont
  // devenus obsolètes. Un taux élevé de ce message signale le second cas.
  if (!offer.priceText && (await hasAnyPrice(page))) {
    log.warning("Prices on the page, none in the product's own price block: price not recorded", {
      url: request.url,
      availability: availabilityText,
    });
  }
  logIdentityRefusals(log, request.url, title, identity);

  return toProduct(request.url, title, keywordOf(request.userData), offer, identity);
}

/**
 * Les refus d'identité sont journalisés : ce sont eux qu'il faudra surveiller
 * si le taux d'extraction se dégrade après une refonte d'Amazon. Ils ne
 * bloquent rien — la fiche est enregistrée sans identifiant, et la cascade de
 * rapprochement sait faire avec.
 */
function logIdentityRefusals(log: Log, url: string, title: string, identity: ExtractedIdentity): void {
  if (identity.ambiguousEan) {
    log.warning('Plusieurs EAN sur la fiche : identité indécidable', { url });
  }
  if (identity.quantity.ambiguous) {
    log.warning('Contenances multiples dans le titre : contenance non retenue', { url, title });
  }
  if (identity.quantity.dosesAmbiguous) {
    log.warning('Doses indécidables (unité ou lot ?) : doses non retenues', { url, title });
  }
  if (identity.pack.issue !== null) {
    log.warning('Nombre d\'unités du titre et de la fiche en désaccord', {
      url,
      issue: identity.pack.issue,
      titlePackSize: identity.quantity.packSize,
      declaredPackSize: identity.packSize,
    });
  }
}

function toProduct(
  url: string,
  title: string,
  keyword: string | null,
  offer: OfferTexts,
  identity: ExtractedIdentity,
): Product {
  return {
    url,
    title,
    price: parsePrice(offer.priceText),
    crossedOutPrice: parsePrice(offer.crossedOutPriceText),
    unitPrice: parseUnitPrice(offer.unitPriceRaw),
    deliveryDate: offer.deliveryDate,
    images: offer.images,
    shop: AMAZON_SHOP,
    keyword,
    scrapedAt: new Date(),
    ean: identity.ean,
    brand: identity.brand,
    mpn: identity.mpn,
    quantity: identity.pack.quantity,
    unitQuantity: identity.pack.unitQuantity,
    packSize: identity.pack.packSize,
    doses: identity.pack.doses,
    unitDoses: identity.pack.unitDoses,
    identityDiagnostics: identity.diagnostics,
  };
}

/** Les déclinaisons héritent du mot-clé de la fiche qui les a fait découvrir. */
async function enqueueVariants({ page, request, enqueueLinks, log }: PlaywrightCrawlingContext): Promise<void> {
  const variantUrls = await extractVariantUrls(page, asinOf(request.url));
  if (variantUrls.length > 0) {
    log.info(`Found ${variantUrls.length} variant(s)`, { url: request.url, variantUrls });
    await enqueueLinks({ urls: variantUrls, userData: { keyword: request.userData.keyword } });
  }
}

/** `null` pour une URL suivie à l'unité, qui n'a pas de mot-clé source. */
function keywordOf(userData: Record<string, unknown>): string | null {
  return typeof userData.keyword === 'string' ? userData.keyword : null;
}

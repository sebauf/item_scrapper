import type { Page } from 'playwright';
import type { PlaywrightCrawlingContext } from 'crawlee';
import type { PageMarkers } from '../../../domain/scrapeFailure/ScrapeFailure.js';
import type { PageEvidence } from './AmazonPageDiagnosis.js';

/**
 * Garde-fou mémoire seulement : les motifs (« Aucun résultat pour »…) sont
 * cherchés dans tout le texte, car l'en-tête de navigation d'Amazon peut à
 * lui seul en occuper les premiers milliers de caractères. La troncature
 * pour le stockage est faite par l'enregistreur.
 */
const BODY_TEXT_MAX_LENGTH = 200_000;

const CAPTCHA_FORM_SELECTOR = 'form[action*="validateCaptcha"], #captchacharacters';
const PRODUCT_LAYOUT_SELECTOR =
  '#dp, #dp-container, #ppd, input#ASIN, #add-to-cart-button, #buy-now-button';
const SEARCH_LAYOUT_SELECTOR = '.s-main-slot, #search';
export const SEARCH_RESULT_SELECTOR = 'div[data-component-type="s-search-result"]';

const NO_MARKERS: PageMarkers = {
  captchaForm: false,
  productLayout: false,
  searchLayout: false,
  searchResults: 0,
};

/**
 * Relève ce qu'il faut pour diagnostiquer une page en échec. Ne lève jamais :
 * la page peut être à moitié chargée, voire fermée — un relevé partiel vaut
 * mieux qu'un échec de diagnostic qui masquerait l'échec de départ.
 */
export async function collectPageEvidence(
  page: Page,
  response: PlaywrightCrawlingContext['response'],
): Promise<{ evidence: PageEvidence; html: string | null }> {
  const html = await page.content().catch(() => null);
  const documentTitle = await page.title().catch(() => '');
  const bodyText = await page
    .evaluate(() => document.body?.innerText ?? '')
    .then((text) => text.replace(/\s+/g, ' ').trim().slice(0, BODY_TEXT_MAX_LENGTH))
    .catch(() => '');
  const markers = await page
    .evaluate(
      ({ captcha, product, search, result }) => ({
        captchaForm: document.querySelector(captcha) !== null,
        productLayout: document.querySelector(product) !== null,
        searchLayout: document.querySelector(search) !== null,
        searchResults: document.querySelectorAll(result).length,
      }),
      {
        captcha: CAPTCHA_FORM_SELECTOR,
        product: PRODUCT_LAYOUT_SELECTOR,
        search: SEARCH_LAYOUT_SELECTOR,
        result: SEARCH_RESULT_SELECTOR,
      },
    )
    .catch(() => NO_MARKERS);

  let httpStatus: number | null = null;
  try {
    httpStatus = response?.status() ?? null;
  } catch {
    httpStatus = null;
  }

  return {
    evidence: {
      finalUrl: page.url(),
      httpStatus,
      documentTitle,
      bodyText,
      htmlLength: html?.length ?? 0,
      markers,
    },
    html,
  };
}

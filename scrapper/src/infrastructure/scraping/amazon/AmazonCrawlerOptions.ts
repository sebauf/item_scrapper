import type { PlaywrightCrawlerOptions, PlaywrightCrawlingContext } from 'crawlee';
import { AMAZON_BROWSER_POOL_OPTIONS, requestFrenchPages } from './AmazonBrowserLocale.js';

/**
 * Réglages communs à tout crawler qui visite amazon.fr : le scrape quotidien
 * (`AmazonCrawler`), le spike de mesure et le script de mise au point. Un
 * crawler réglé autrement serait servi autrement — pages de blocage, ou
 * fiches en anglais — et ce qu'il mesurerait ne vaudrait pas pour le scrape.
 */

/**
 * Allure volontairement basse. À ce rythme, le budget de 1 000 pages prend
 * ~100 min : c'est ce qui fixe le `execution_timeout` de 3 h de la tâche
 * `scrape` (airflow/dags/price_pipeline_dag.py).
 */
export const MAX_REQUESTS_PER_MINUTE = 10;

/** Sessions à cookies persistants, retirées après 50 pages ou 3 erreurs. */
const SESSION_POOL_OPTIONS = {
  maxPoolSize: 10,
  sessionOptions: { maxUsageCount: 50, maxErrorScore: 3 },
};

/** `navigator.webdriver`, vrai sous Playwright, trahit le robot. */
async function hideWebdriverFlag({ page }: PlaywrightCrawlingContext): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
}

export const AMAZON_CRAWLER_OPTIONS = {
  maxRequestsPerMinute: MAX_REQUESTS_PER_MINUTE,
  useSessionPool: true,
  sessionPoolOptions: SESSION_POOL_OPTIONS,
  // Fiches en français : sans cela, amazon.fr sert de l'anglais à
  // l'empreinte en-US par défaut de Crawlee (cf. AmazonBrowserLocale).
  browserPoolOptions: AMAZON_BROWSER_POOL_OPTIONS,
  preNavigationHooks: [requestFrenchPages, hideWebdriverFlag],
  launchContext: {
    launchOptions: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    },
  },
} satisfies PlaywrightCrawlerOptions;

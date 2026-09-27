import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { PlaywrightCrawler } from 'crawlee';
import { MongoClient } from 'mongodb';
import { extractAmazonIdentity, type ExtractedIdentity } from '../infrastructure/scraping/amazon/AmazonIdentityExtractor.js';

/**
 * Harnais de mesure du spike « extraction d'identité Amazon ».
 *
 * Il ne scrape rien en base et ne modifie aucune collection : il visite un
 * échantillon de fiches et **compte** ce qu'Amazon expose réellement. Le
 * chiffre qu'il produit — le taux de présence d'un EAN vérifiable — décide
 * de la suite : au-dessus de ~60 %, le rapprochement inter-enseignes est
 * essentiellement un problème résolu ; en dessous de ~25 %, il faudra
 * investir dans les attributs et la validation humaine.
 *
 * Usage :
 *   npm run spike:jsonld                      # 20 URLs tirées de price_history
 *   npm run spike:jsonld -- --limit=50
 *   npm run spike:jsonld -- --urls=urls.txt   # une URL par ligne, sans Mongo
 *   npm run spike:jsonld -- --out=rapport.json
 *
 * Le crawler est volontairement recopié ici plutôt que réutilisé depuis
 * `AmazonCrawler` : celui-ci écrit en base, ce qu'un spike ne doit pas
 * faire. La configuration anti-détection est en revanche identique, sans
 * quoi la mesure porterait sur des pages de blocage.
 */

const DEFAULT_LIMIT = 20;
const DEFAULT_OUT = 'spike-jsonld.json';

interface Observation {
  url: string;
  title: string;
  blocked: boolean;
  jsonLdScriptCount: number;
  jsonLdHasProduct: boolean;
  jsonLdGtin: string | null;
  ean: string | null;
  eanSource: 'json-ld' | 'details' | null;
  ambiguousEan: boolean;
  brand: string | null;
  mpn: string | null;
  quantityAmount: number | null;
  quantityUnit: string | null;
  quantityAmbiguous: boolean;
  doses: number | null;
}

function readArg(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null;
}

async function loadUrls(limit: number): Promise<string[]> {
  const file = readArg('urls');
  if (file !== null) {
    const content = await readFile(file, 'utf8');
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
      .slice(0, limit);
  }

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error(
      'Ni --urls=<fichier> ni MONGODB_URI : impossible de constituer un échantillon.',
    );
  }

  const client = new MongoClient(mongoUri);
  await client.connect();
  try {
    // Échantillon aléatoire plutôt que les N premiers : les produits les plus
    // anciens ne sont pas représentatifs du catalogue suivi aujourd'hui.
    const docs = await client
      .db('scrapper')
      .collection<{ _id: string }>('price_history')
      .aggregate<{ _id: string }>([
        { $match: { unavailable: { $ne: true }, shop: 'amazon' } },
        { $sample: { size: limit } },
        { $project: { _id: 1 } },
      ])
      .toArray();
    return docs.map((doc) => doc._id);
  } finally {
    await client.close();
  }
}

function toObservation(url: string, title: string, identity: ExtractedIdentity): Observation {
  return {
    url,
    title,
    blocked: title.length === 0,
    jsonLdScriptCount: identity.jsonLdScriptCount,
    jsonLdHasProduct: identity.jsonLd !== null,
    jsonLdGtin: identity.jsonLd?.gtin ?? null,
    ean: identity.ean,
    eanSource: identity.eanSource,
    ambiguousEan: identity.ambiguousEan,
    brand: identity.brand,
    mpn: identity.mpn,
    quantityAmount: identity.quantity.quantity?.amount ?? null,
    quantityUnit: identity.quantity.quantity?.unit ?? null,
    quantityAmbiguous: identity.quantity.ambiguous,
    doses: identity.quantity.doses,
  };
}

function percent(count: number, total: number): string {
  return total === 0 ? '—' : `${((count / total) * 100).toFixed(0).padStart(3)} %`;
}

function report(observations: readonly Observation[]): void {
  const usable = observations.filter((row) => !row.blocked);
  const n = usable.length;
  const count = (predicate: (row: Observation) => boolean): number =>
    usable.filter(predicate).length;

  const lines: Array<[string, number]> = [
    ['Page exploitable (titre extrait)', n],
    ['  dont au moins un bloc JSON-LD', count((r) => r.jsonLdScriptCount > 0)],
    ['  dont un nœud JSON-LD de type Product', count((r) => r.jsonLdHasProduct)],
    ['  dont un GTIN dans le JSON-LD', count((r) => r.jsonLdGtin !== null)],
    ['EAN vérifié, toutes sources', count((r) => r.ean !== null)],
    ['  provenant du JSON-LD', count((r) => r.eanSource === 'json-ld')],
    ['  provenant des caractéristiques', count((r) => r.eanSource === 'details')],
    ['  écarté car plusieurs EAN sur la fiche', count((r) => r.ambiguousEan)],
    ['Marque', count((r) => r.brand !== null)],
    ['Référence fabricant', count((r) => r.mpn !== null)],
    ['Contenance normalisée depuis le titre', count((r) => r.quantityAmount !== null)],
    ['  écartée car titre ambigu', count((r) => r.quantityAmbiguous)],
    ['Nombre de doses / lavages', count((r) => r.doses !== null)],
  ];

  const blocked = observations.length - n;
  console.log(`\n=== Spike extraction d'identité Amazon ===`);
  console.log(`Pages visitées : ${observations.length}  |  bloquées/vides : ${blocked}\n`);
  for (const [label, value] of lines) {
    console.log(`${label.padEnd(44)} ${String(value).padStart(3)}   ${percent(value, n)}`);
  }

  const identifiable = count((r) => r.ean !== null);
  const comparable = count((r) => r.ean !== null || (r.brand !== null && r.quantityAmount !== null));
  console.log(`\nRapprochement déterministe possible (EAN)      : ${percent(identifiable, n)}`);
  console.log(`Rapprochement possible EAN ou marque+contenance: ${percent(comparable, n)}`);
  if (blocked > 0) {
    console.log(
      `\n⚠ ${blocked} page(s) sans titre : Amazon a probablement servi un captcha.\n` +
        `  Les pourcentages portent sur les pages exploitables uniquement.`,
    );
  }
}

async function main(): Promise<void> {
  const limit = Number(readArg('limit') ?? DEFAULT_LIMIT);
  const out = readArg('out') ?? DEFAULT_OUT;
  const urls = await loadUrls(Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_LIMIT);

  if (urls.length === 0) {
    console.error('Aucune URL à visiter.');
    process.exit(1);
  }
  console.log(`Échantillon : ${urls.length} fiche(s).`);

  const observations: Observation[] = [];

  const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: urls.length,
    maxConcurrency: 1,
    maxRequestsPerMinute: 10,
    useSessionPool: true,
    sessionPoolOptions: {
      maxPoolSize: 10,
      sessionOptions: { maxUsageCount: 50, maxErrorScore: 3 },
    },
    preNavigationHooks: [
      async ({ page }) => {
        await page.addInitScript(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });
      },
    ],
    launchContext: {
      launchOptions: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
        ],
      },
    },
    requestHandler: async ({ page, request, log }) => {
      await page.waitForTimeout(800 + Math.random() * 600);
      const title = await page
        .$eval('#productTitle', (el) => el.textContent?.trim() ?? '')
        .catch(() => '');
      const identity = await extractAmazonIdentity(page, title);
      observations.push(toObservation(request.url, title, identity));
      log.info(
        `${title.slice(0, 60) || '(bloqué)'} — EAN ${identity.ean ?? '—'} (${identity.eanSource ?? 'aucune source'})`,
      );
    },
    failedRequestHandler: ({ request, log }) => {
      log.warning(`Échec définitif : ${request.url}`);
      observations.push(
        toObservation(request.url, '', {
          ean: null,
          eanSource: null,
          brand: null,
          mpn: null,
          asin: null,
          ambiguousEan: false,
          jsonLd: null,
          jsonLdScriptCount: 0,
          quantity: {
            quantity: null,
            packSize: null,
            perPack: null,
            doses: null,
            ambiguous: false,
            raw: null,
          },
        }),
      );
    },
  });

  await crawler.run(urls);

  report(observations);
  writeFileSync(out, JSON.stringify(observations, null, 2), 'utf8');
  console.log(`\nRelevé détaillé écrit dans ${out}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

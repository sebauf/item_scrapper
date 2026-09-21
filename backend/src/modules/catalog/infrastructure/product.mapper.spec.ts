import { DEAL_SCORE_THRESHOLD } from '../domain/deal-policy';
import { ProductId } from '../domain/product-id';
import { toHistoryEntries, toIso, toProductSummary } from './product.mapper';

/**
 * Frontière entre le schéma Mongo et le contrat d'API.
 *
 * Le mapper est écrit défensivement parce que `items_raw` est alimenté par le
 * scrapper : un champ peut manquer, changer de type, ou arriver d'une version
 * antérieure du crawler. Ces tests décrivent ce qui arrive alors — jamais une
 * exception, jamais un `undefined` qui disparaîtrait du JSON de réponse.
 */
describe('toIso', () => {
  it('convertit une Date', () => {
    expect(toIso(new Date('2026-08-08T06:00:00.000Z'))).toBe('2026-08-08T06:00:00.000Z');
  });

  it('convertit une chaîne et un timestamp lisibles', () => {
    expect(toIso('2026-08-08T06:00:00.000Z')).toBe('2026-08-08T06:00:00.000Z');
    expect(toIso(Date.UTC(2026, 7, 8, 6))).toBe('2026-08-08T06:00:00.000Z');
  });

  it('rend telle quelle une chaîne illisible', () => {
    expect(toIso('bientôt')).toBe('bientôt');
  });

  it.each([[null], [undefined], [{}], [[]], [true]])('rend null pour %p', (value) => {
    expect(toIso(value)).toBeNull();
  });
});

describe('toProductSummary', () => {
  const doc = {
    url: 'https://www.amazon.fr/dp/B0TEST0001',
    keyword: 'lessive',
    shop: 'amazon',
    title: 'Lessive liquide 3L',
    images: ['https://img.example/a.jpg'],
    price: { amount: 12.99, currency: 'EUR' },
    crossedOutPrice: { amount: 19.99, currency: 'EUR' },
    unitPrice: { amount: 4.33, unit: 'L' },
    deliveryDate: 'Livraison lundi 11 août',
    scrapedAt: new Date('2026-08-08T06:00:00.000Z'),
    dealScore: 35,
    predictedPrice: 19.99,
    trendDirection: 'down',
  };

  it('traduit un document complet', () => {
    expect(toProductSummary(doc)).toEqual({
      id: ProductId.fromUrl(doc.url).value,
      url: doc.url,
      keyword: 'lessive',
      shop: 'amazon',
      title: 'Lessive liquide 3L',
      images: ['https://img.example/a.jpg'],
      price: { amount: 12.99, currency: 'EUR' },
      crossedOutPrice: { amount: 19.99, currency: 'EUR' },
      unitPrice: { amount: 4.33, unit: 'L' },
      deliveryDate: 'Livraison lundi 11 août',
      scrapedAt: '2026-08-08T06:00:00.000Z',
      dealScore: 35,
      predictedPrice: 19.99,
      trendDirection: 'down',
      isDeal: true,
    });
  });

  it("expose un identifiant utilisable dans une URL, qui redonne l'URL du produit", () => {
    const { id } = toProductSummary(doc);

    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(ProductId.fromEncoded(id).url).toBe(doc.url);
  });

  describe('champs absents ou aberrants', () => {
    it('ne laisse aucun undefined dans la réponse', () => {
      const summary = toProductSummary({ url: doc.url });

      expect(summary).toMatchObject({
        keyword: null,
        shop: 'amazon', // seule boutique gérée à ce jour
        title: '',
        images: [],
        price: null,
        crossedOutPrice: null,
        unitPrice: null,
        deliveryDate: null,
        scrapedAt: '',
        dealScore: null,
        predictedPrice: null,
        trendDirection: null,
        isDeal: false,
      });
      expect(Object.values(summary)).not.toContain(undefined);
    });

    it('rejette un montant incomplet plutôt que de le servir à moitié', () => {
      expect(toProductSummary({ ...doc, price: { amount: 12.99 } }).price).toBeNull();
      expect(toProductSummary({ ...doc, price: { currency: 'EUR' } }).price).toBeNull();
      expect(toProductSummary({ ...doc, unitPrice: { amount: 4.33 } }).unitPrice).toBeNull();
    });

    it('ignore une tendance hors nomenclature', () => {
      expect(toProductSummary({ ...doc, trendDirection: 'sideways' }).trendDirection).toBeNull();
    });

    it.each([[NaN], [Infinity], ['35'], [null]])('ignore un score non fini (%p)', (dealScore) => {
      const summary = toProductSummary({ ...doc, dealScore });

      expect(summary.dealScore).toBeNull();
      expect(summary.isDeal).toBe(false);
    });

    it('ne garde que les images qui sont des chaînes', () => {
      expect(toProductSummary({ ...doc, images: ['ok.jpg', 42, null] }).images).toEqual(['ok.jpg']);
      expect(toProductSummary({ ...doc, images: 'pas-un-tableau' }).images).toEqual([]);
    });
  });

  describe('verdict « bonne affaire »', () => {
    it.each([
      [DEAL_SCORE_THRESHOLD - 0.1, false],
      [DEAL_SCORE_THRESHOLD, true],
      [DEAL_SCORE_THRESHOLD + 20, true],
      [0, false],
      [-5, false],
    ])('score %p → isDeal %p', (dealScore, expected) => {
      expect(toProductSummary({ ...doc, dealScore }).isDeal).toBe(expected);
    });
  });
});

describe('toHistoryEntries', () => {
  it('traduit chaque relevé', () => {
    const entries = toHistoryEntries([
      {
        day: new Date('2026-08-07T00:00:00.000Z'),
        price: { amount: 14.99, currency: 'EUR' },
        crossedOutPrice: null,
        unitPrice: { amount: 5, unit: 'L' },
        scrapedAt: new Date('2026-08-07T06:00:00.000Z'),
      },
    ]);

    expect(entries).toEqual([
      {
        day: '2026-08-07T00:00:00.000Z',
        price: { amount: 14.99, currency: 'EUR' },
        crossedOutPrice: null,
        unitPrice: { amount: 5, unit: 'L' },
        scrapedAt: '2026-08-07T06:00:00.000Z',
      },
    ]);
  });

  it('accepte un historique absent', () => {
    expect(toHistoryEntries(undefined)).toEqual([]);
    expect(toHistoryEntries([])).toEqual([]);
  });

  it('garde un jour sans prix — le produit était indisponible', () => {
    const [entry] = toHistoryEntries([{ day: new Date('2026-08-07T00:00:00.000Z') }]);

    expect(entry.price).toBeNull();
    expect(entry.day).toBe('2026-08-07T00:00:00.000Z');
    expect(entry.scrapedAt).toBe('');
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeJsonLdProducts, parseJsonLdProducts } from './JsonLdParser.js';

/** Forme publiée par un distributeur alimentaire : `Product` complet. */
const RETAILER_PRODUCT = JSON.stringify({
  '@context': 'https://schema.org/',
  '@type': 'Product',
  name: 'Lessive liquide Ariel Original 1,5L',
  gtin13: '3014260610807',
  brand: { '@type': 'Brand', name: 'Ariel' },
  sku: '1234567',
  offers: { '@type': 'Offer', price: '9.49', priceCurrency: 'EUR' },
});

/**
 * Forme fréquemment observée chez Amazon : du JSON-LD, mais de navigation —
 * aucun nœud `Product`, donc aucun code-barres. C'est le cas que le spike
 * doit quantifier, et il doit se traduire par `null`, pas par une erreur.
 */
const BREADCRUMB_ONLY = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Epicerie' }],
});

describe('JsonLdParser', () => {
  describe('extraction', () => {
    it('lit un Product complet', () => {
      const [product] = parseJsonLdProducts([RETAILER_PRODUCT]);
      assert.deepEqual(product, {
        name: 'Lessive liquide Ariel Original 1,5L',
        brand: 'Ariel',
        gtin: '3014260610807',
        mpn: null,
        sku: '1234567',
        price: 9.49,
        currency: 'EUR',
      });
    });

    it('ne trouve aucun produit dans un JSON-LD de navigation', () => {
      assert.deepEqual(parseJsonLdProducts([BREADCRUMB_ONLY]), []);
      assert.equal(mergeJsonLdProducts(parseJsonLdProducts([BREADCRUMB_ONLY])), null);
    });

    it('descend dans @graph', () => {
      const raw = JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [{ '@type': 'WebPage' }, { '@type': 'Product', gtin13: '4005809001209' }],
      });
      assert.equal(parseJsonLdProducts([raw])[0].gtin, '4005809001209');
    });

    it('accepte un tableau racine et un @type multiple', () => {
      const raw = JSON.stringify([
        { '@type': ['Product', 'IndividualProduct'], name: 'Adoucissant', gtin13: '8019010000100' },
      ]);
      const [product] = parseJsonLdProducts([raw]);
      assert.equal(product.name, 'Adoucissant');
      assert.equal(product.gtin, '8019010000100');
    });

    it('lit le prix d’un tableau d’offres et d’un AggregateOffer', () => {
      const array = JSON.stringify({
        '@type': 'Product',
        offers: [{ '@type': 'Offer', price: 12.9, priceCurrency: 'EUR' }],
      });
      const aggregate = JSON.stringify({
        '@type': 'Product',
        offers: { '@type': 'AggregateOffer', lowPrice: '7,20', priceCurrency: 'EUR' },
      });
      assert.equal(parseJsonLdProducts([array])[0].price, 12.9);
      assert.equal(parseJsonLdProducts([aggregate])[0].price, 7.2);
    });

    it('lit un code-barres préfixé dans productID', () => {
      const raw = JSON.stringify({ '@type': 'Product', productID: 'ean:5000158000056' });
      assert.equal(parseJsonLdProducts([raw])[0].gtin, '5000158000056');
    });
  });

  describe('robustesse', () => {
    it('ignore un bloc mal formé sans interrompre les autres', () => {
      const products = parseJsonLdProducts(['{ ceci n’est pas du JSON', RETAILER_PRODUCT]);
      assert.equal(products.length, 1);
      assert.equal(products[0].gtin, '3014260610807');
    });

    it('écarte un gtin13 dont la clé de contrôle est fausse', () => {
      const raw = JSON.stringify({ '@type': 'Product', gtin13: '3014260610806' });
      assert.equal(parseJsonLdProducts([raw])[0].gtin, null);
    });

    it('ne boucle pas sur une structure profondément imbriquée', () => {
      let deep: Record<string, unknown> = { '@type': 'Product', gtin13: '3014260610807' };
      for (let i = 0; i < 200; i++) deep = { nested: deep };
      assert.doesNotThrow(() => parseJsonLdProducts([JSON.stringify(deep)]));
    });

    it('rend une liste vide sur une entrée vide', () => {
      assert.deepEqual(parseJsonLdProducts([]), []);
      assert.deepEqual(parseJsonLdProducts(['null']), []);
    });
  });

  describe('fusion', () => {
    it('retient la première valeur non vide, champ par champ', () => {
      const partial = JSON.stringify({ '@type': 'Product', name: 'Recommandé', brand: 'Skip' });
      const merged = mergeJsonLdProducts(parseJsonLdProducts([partial, RETAILER_PRODUCT]));
      assert.equal(merged?.name, 'Recommandé');
      assert.equal(merged?.brand, 'Skip');
      // Absent du premier nœud : complété par le second.
      assert.equal(merged?.gtin, '3014260610807');
    });
  });
});

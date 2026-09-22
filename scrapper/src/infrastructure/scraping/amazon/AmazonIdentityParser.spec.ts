import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmazonDetails, splitDetailBullet } from './AmazonIdentityParser.js';

/**
 * Les puces reproduisent le balisage réel d'Amazon, marques directionnelles
 * comprises (U+200F avant le deux-points, U+200E après). Les retirer des
 * fixtures rendrait les tests verts sur du code cassé en production — c'est
 * exactement le piège que ce module existe pour éviter.
 */
const BULLET_ASIN = 'ASIN‏ : ‎B0CZ1TL7XK';
const BULLET_EAN = 'EAN‏ : ‎3014260610807';

describe('AmazonIdentityParser', () => {
  describe('découpage des puces', () => {
    it('sépare libellé et valeur malgré les caractères invisibles', () => {
      assert.deepEqual(splitDetailBullet(BULLET_EAN), { label: 'EAN', value: '3014260610807' });
    });

    it('écarte une puce décorative sans séparateur', () => {
      assert.equal(splitDetailBullet('Voir les 100 premiers en Epicerie'), null);
      assert.equal(splitDetailBullet(''), null);
      assert.equal(splitDetailBullet(': valeur orpheline'), null);
    });
  });

  describe('identité', () => {
    const entries = [
      splitDetailBullet(BULLET_ASIN)!,
      splitDetailBullet(BULLET_EAN)!,
      { label: 'Marque', value: 'Ariel' },
      { label: 'Numéro du modèle de l’article', value: '8001841234567' },
    ];

    it('relève EAN, ASIN, marque et référence', () => {
      const identity = parseAmazonDetails(entries);
      assert.equal(identity.ean, '3014260610807');
      assert.equal(identity.asin, 'B0CZ1TL7XK');
      assert.equal(identity.brand, 'Ariel');
      assert.equal(identity.mpn, '8001841234567');
      assert.equal(identity.ambiguousEan, false);
    });

    it('apparie les libellés sans tenir compte des accents ni de la casse', () => {
      const identity = parseAmazonDetails([
        { label: 'Numero du Modele de l article', value: 'REF-42' },
        { label: 'FABRICANT', value: 'Procter & Gamble' },
      ]);
      assert.equal(identity.mpn, 'REF-42');
      assert.equal(identity.brand, 'Procter & Gamble');
    });

    it('retombe sur l’UPC quand la fiche n’a pas d’EAN', () => {
      const identity = parseAmazonDetails([{ label: 'UPC', value: '036000291452' }]);
      assert.equal(identity.ean, '0036000291452');
    });

    it('préfère l’EAN à l’UPC quand les deux sont publiés', () => {
      const identity = parseAmazonDetails([
        { label: 'UPC', value: '036000291452' },
        { label: 'EAN', value: '3014260610807' },
      ]);
      assert.equal(identity.ean, '3014260610807');
    });
  });

  describe('refus', () => {
    it('refuse de choisir quand la fiche porte plusieurs EAN', () => {
      // Cas réel des lots : Amazon liste les codes de chaque référence.
      const identity = parseAmazonDetails([
        { label: 'EAN', value: '3014260610807 4005809001209' },
      ]);
      assert.equal(identity.ean, null);
      assert.equal(identity.ambiguousEan, true);
    });

    it('dédoublonne un même EAN répété — ce n’est pas une ambiguïté', () => {
      const identity = parseAmazonDetails([
        { label: 'EAN', value: '3014260610807' },
        { label: 'EAN', value: '3014260610807' },
      ]);
      assert.equal(identity.ean, '3014260610807');
      assert.equal(identity.ambiguousEan, false);
    });

    it('écarte un EAN dont la clé de contrôle est fausse', () => {
      const identity = parseAmazonDetails([{ label: 'EAN', value: '3014260610806' }]);
      assert.equal(identity.ean, null);
      assert.equal(identity.ambiguousEan, false);
    });

    it('ne prend pas la référence fabricant pour un code-barres', () => {
      const identity = parseAmazonDetails([{ label: 'Référence fabricant', value: '8001841' }]);
      assert.equal(identity.ean, null);
      assert.equal(identity.mpn, '8001841');
      assert.equal(identity.brand, null);
    });

    it('rend une identité vide sur une fiche sans caractéristiques', () => {
      const identity = parseAmazonDetails([]);
      assert.deepEqual(identity, {
        ean: null,
        brand: null,
        mpn: null,
        asin: null,
        ambiguousEan: false,
      });
    });
  });
});

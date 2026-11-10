import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmazonDetails, readItemCount, splitDetailBullet } from './AmazonIdentityParser.js';

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

  describe('nombre d’articles', () => {
    it('lit « Nombre d’articles », marques invisibles comprises', () => {
      const entry = splitDetailBullet('Nombre d’articles‏ : ‎2')!;
      assert.equal(parseAmazonDetails([entry]).packSize, 2);
    });

    it('accepte l’entier écrit en flottant ou suivi de son unité', () => {
      assert.equal(readItemCount('1.0'), 1);
      assert.equal(readItemCount('3,0'), 3);
      assert.equal(readItemCount('6 unités'), 6);
    });

    it('écarte une contenance publiée à la place d’un nombre', () => {
      assert.equal(readItemCount('1500.0 millilitre'), null);
      assert.equal(readItemCount('1,5'), null);
      assert.equal(readItemCount('0'), null);
    });

    it('ignore « Nombre d’unités », qui porte souvent une contenance', () => {
      const identity = parseAmazonDetails([{ label: 'Nombre d’unités', value: '3' }]);
      assert.equal(identity.packSize, null);
    });

    it('refuse de choisir entre deux déclarations différentes', () => {
      const identity = parseAmazonDetails([
        { label: 'Nombre d’articles', value: '1' },
        { label: "Nombre d'articles", value: '2' },
      ]);
      assert.equal(identity.packSize, null);
    });
  });

  describe('fiches servies en anglais', () => {
    // Libellés relevés tels quels le 10/11/2026 sur 927 fiches amazon.fr
    // servies en anglais (identityDiagnostics.detailLabels).
    const english = [
      { label: 'ASIN', value: 'B0CZ1TL7XK' },
      { label: 'Manufacturer', value: 'Procter & Gamble' },
      { label: 'Unit count', value: '10.0 Count' },
      { label: 'Number of Items', value: '1' },
      { label: 'Brand Name', value: 'Oral-B' },
      { label: 'Model name', value: 'CrossAction' },
      { label: 'Item model number', value: 'EB50-10' },
      { label: 'Manufacturer contact information', value: 'Procter & Gamble France' },
      { label: 'Global Trade Identification Number', value: '04210201301660' },
    ];

    it('lit code-barres, marque, référence et nombre d’articles', () => {
      const identity = parseAmazonDetails(english);
      // GTIN-14 à indicateur 0 : ramené à l'EAN-13 de l'unité consommateur.
      assert.equal(identity.ean, '4210201301660');
      assert.equal(identity.brand, 'Oral-B');
      assert.equal(identity.mpn, 'EB50-10');
      assert.equal(identity.packSize, 1);
      assert.equal(identity.asin, 'B0CZ1TL7XK');
    });

    it('ne prend ni la gamme pour une référence, ni le contact pour la marque', () => {
      const identity = parseAmazonDetails([
        { label: 'Model name', value: 'CrossAction' },
        { label: 'Manufacturer contact information', value: 'Procter & Gamble France' },
      ]);
      assert.equal(identity.mpn, null);
      assert.equal(identity.brand, null);
    });

    it('n’interprète pas « Unit count » comme un nombre d’articles', () => {
      assert.equal(parseAmazonDetails([{ label: 'Unit count', value: '10.0 Count' }]).packSize, null);
    });

    it('retombe sur « Manufacturer » sans « Brand Name »', () => {
      assert.equal(parseAmazonDetails([{ label: 'Manufacturer', value: 'Brita' }]).brand, 'Brita');
    });

    it('lit les variantes de référence fabricant', () => {
      for (const label of ['Part Number', 'Model number', 'Manufacturer reference', 'Manufacturer Part Number', 'ManufacturerPartNumber']) {
        assert.equal(parseAmazonDetails([{ label, value: 'REF-1' }]).mpn, 'REF-1', label);
      }
    });

    it('refuse plusieurs GTIN distincts, comme plusieurs EAN', () => {
      const identity = parseAmazonDetails([
        { label: 'Global Trade Identification Number', value: '3014260610807' },
        { label: 'EAN', value: '4005809001209' },
      ]);
      assert.equal(identity.ean, null);
      assert.equal(identity.ambiguousEan, true);
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
        packSize: null,
      });
    });
  });
});

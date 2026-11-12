import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NO_SIGNALS, resolveAmazonIdentity, summarizeLabels } from './AmazonIdentityCascade.js';

/** Bloc JSON-LD `Product` d'une fiche qui publie son code-barres. */
const JSON_LD_WITH_GTIN = JSON.stringify({
  '@context': 'https://schema.org/',
  '@type': 'Product',
  name: 'Finish Powerball Quantum',
  gtin13: '5908252010820',
  brand: { '@type': 'Brand', name: 'Finish (JSON-LD)' },
});

/** Caractéristiques telles qu'Amazon les écrit, marques invisibles comprises. */
const DETAILS = [
  { label: 'Marque‏ ', value: '‎Finish' },
  { label: 'EAN‏ ', value: '‎3014260610807' },
  { label: 'Nombre d’ articles‏ ', value: '‎2' },
];

const TITLE = 'Finish Powerball Quantum Tablettes Lave-Vaisselle, 2 x 40 tablettes';

describe('AmazonIdentityCascade', () => {
  describe('cascade', () => {
    it("prend l'EAN du JSON-LD d'abord, la marque des caractéristiques d'abord", () => {
      const identity = resolveAmazonIdentity(
        { jsonLdScripts: [JSON_LD_WITH_GTIN], detailEntries: DETAILS, signals: NO_SIGNALS },
        TITLE,
      );
      assert.equal(identity.ean, '5908252010820');
      assert.equal(identity.eanSource, 'json-ld');
      assert.equal(identity.brand, 'Finish');
    });

    it('retombe sur les caractéristiques sans GTIN dans le JSON-LD', () => {
      const identity = resolveAmazonIdentity(
        { jsonLdScripts: [], detailEntries: DETAILS, signals: NO_SIGNALS },
        TITLE,
      );
      assert.equal(identity.ean, '3014260610807');
      assert.equal(identity.eanSource, 'details');
      assert.equal(identity.diagnostics.declaredPackSize, 2);
      assert.equal(identity.diagnostics.detailEntries, 3);
    });

    it("n'invente rien d'une page muette", () => {
      const identity = resolveAmazonIdentity(
        { jsonLdScripts: [], detailEntries: [], signals: NO_SIGNALS },
        'Produit',
      );
      assert.equal(identity.ean, null);
      assert.equal(identity.eanSource, null);
      assert.equal(identity.brand, null);
      assert.equal(identity.diagnostics.jsonLdProduct, false);
    });
  });

  // Les libellés relevés servent au diagnostic — c'est par eux qu'on verra si
  // Amazon écrit « Nombre d'articles » autrement.
  describe('libellés de diagnostic', () => {
    it('normalise, dédoublonne et retire les marques invisibles', () => {
      const labels = summarizeLabels([
        { label: 'EAN‏ ', value: '3014260610807' },
        { label: 'Numéro du modèle de l’article', value: 'REF' },
        { label: 'Numero du Modele de l’article', value: 'REF' },
      ]);
      assert.deepEqual(labels, ['ean', 'numero du modele de l’article']);
    });

    it('borne le nombre et la longueur des libellés', () => {
      const many = Array.from({ length: 100 }, (_, i) => ({ label: `libellé ${i}`, value: 'x' }));
      assert.equal(summarizeLabels(many).length, 40);
      const long = summarizeLabels([{ label: 'x'.repeat(500), value: 'y' }]);
      assert.equal(long[0].length, 60);
    });

    it('ignore les libellés vides', () => {
      assert.deepEqual(summarizeLabels([{ label: ' : ', value: 'x' }]), []);
    });
  });
});

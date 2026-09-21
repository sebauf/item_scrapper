import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hasValidGtinChecksum, normalizeGtin } from './Gtin.js';

describe('Gtin', () => {
  describe('clé de contrôle', () => {
    it('accepte un EAN-13 valide', () => {
      assert.equal(hasValidGtinChecksum('3014260610807'), true);
    });

    it('rejette un EAN-13 dont un chiffre a été altéré', () => {
      assert.equal(hasValidGtinChecksum('3014260610806'), false);
    });

    it('accepte un EAN-8 et un UPC-12 valides', () => {
      assert.equal(hasValidGtinChecksum('96385074'), true);
      assert.equal(hasValidGtinChecksum('036000291452'), true);
    });
  });

  describe('normalisation', () => {
    it('laisse un EAN-13 valide inchangé', () => {
      assert.equal(normalizeGtin('4005809001209'), '4005809001209');
    });

    it('nettoie espaces, tirets et marques directionnelles Amazon', () => {
      assert.equal(normalizeGtin('‏ 3014-260-610807 ‎'), '3014260610807');
    });

    it("préfixe un UPC-12 d'un zéro — c'est le même article", () => {
      assert.equal(normalizeGtin('036000291452'), '0036000291452');
    });

    it('accepte un GTIN-14 unitaire (indicateur 0) en retirant l’indicateur', () => {
      assert.equal(normalizeGtin('03014260610807'), '3014260610807');
    });

    it('refuse un GTIN-14 de regroupement — un carton n’est pas l’unité', () => {
      // Indicateur 6 : même article, mais conditionné par lot.
      const carton = '63014260610809';
      assert.equal(hasValidGtinChecksum(carton), true);
      assert.equal(normalizeGtin(carton), null);
    });

    it('refuse une référence fabricant numérique qui n’est pas un GTIN', () => {
      assert.equal(normalizeGtin('123456789'), null);
      assert.equal(normalizeGtin('1234567890123'), null);
    });

    it('refuse une entrée vide, non numérique ou non textuelle', () => {
      assert.equal(normalizeGtin(''), null);
      assert.equal(normalizeGtin('B0CZ1TL7XK'), null);
      assert.equal(normalizeGtin(null), null);
      assert.equal(normalizeGtin(undefined), null);
      assert.equal(normalizeGtin({}), null);
    });
  });
});

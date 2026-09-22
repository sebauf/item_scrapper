import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isEmptyQuantity, parseQuantity } from './QuantityParser.js';

/**
 * Les titres de ce fichier sont volontairement écrits dans le style réel des
 * fiches de grande consommation : majuscules, virgule décimale, mentions
 * commerciales intercalées. Des titres inventés « propres » donneraient une
 * fausse confiance — ce sont les formes tordues qui cassent un parseur.
 */
describe('QuantityParser', () => {
  describe('contenance simple', () => {
    it('lit un volume en litres avec virgule décimale', () => {
      const parsed = parseQuantity('Ariel Lessive Liquide Original 1,5 L');
      assert.deepEqual(parsed.quantity, { amount: 1.5, unit: 'L' });
      assert.equal(parsed.packSize, null);
    });

    it('ramène millilitres et centilitres au litre', () => {
      assert.deepEqual(parseQuantity('Finish Liquide de Rinçage 800 ml').quantity, {
        amount: 0.8,
        unit: 'L',
      });
      assert.deepEqual(parseQuantity('Vinaigre de nettoyage 75 cl').quantity, {
        amount: 0.75,
        unit: 'L',
      });
    });

    it('reconnaît les trois écritures d’une même contenance', () => {
      const forms = ['Produit 750 ml', 'Produit 75 cl', 'Produit 0,75 L'];
      const amounts = forms.map((title) => parseQuantity(title).quantity?.amount);
      assert.deepEqual(amounts, [0.75, 0.75, 0.75]);
    });

    it('ramène les grammes au kilogramme', () => {
      assert.deepEqual(parseQuantity('Lessive en poudre 4,5 kg').quantity, {
        amount: 4.5,
        unit: 'kg',
      });
      assert.deepEqual(parseQuantity('Bicarbonate 500g').quantity, { amount: 0.5, unit: 'kg' });
    });

    it('tolère l’absence d’espace et la casse', () => {
      assert.deepEqual(parseQuantity('SKIP ACTIVE CLEAN 3,25L').quantity, {
        amount: 3.25,
        unit: 'L',
      });
    });

    it('gère les espaces insécables des titres marchands', () => {
      assert.deepEqual(parseQuantity('Lenor Adoucissant 1,32 L').quantity, {
        amount: 1.32,
        unit: 'L',
      });
    });
  });

  describe('lots', () => {
    it('applique un multiplicateur « 3 x 1 L »', () => {
      const parsed = parseQuantity('Persil Lessive Liquide 3 x 1L');
      assert.deepEqual(parsed.quantity, { amount: 3, unit: 'L' });
      assert.deepEqual(parsed.perPack, { amount: 1, unit: 'L' });
      assert.equal(parsed.packSize, 3);
    });

    it('accepte le signe × et le multiplicateur suffixe', () => {
      assert.deepEqual(parseQuantity('Adoucissant 2×500 ml').quantity, { amount: 1, unit: 'L' });
      assert.deepEqual(parseQuantity('Lessive 1,5L x 2').quantity, { amount: 3, unit: 'L' });
    });

    it('applique « Lot de N »', () => {
      const parsed = parseQuantity('Le Chat Bébé Lessive Liquide 2L - Lot de 2');
      assert.deepEqual(parsed.quantity, { amount: 4, unit: 'L' });
      assert.equal(parsed.packSize, 2);
      assert.deepEqual(parsed.perPack, { amount: 2, unit: 'L' });
    });

    it('ne multiplie pas deux fois un lot déjà écrit « N x »', () => {
      // « Lot de 3 » et « 3 x 1L » désignent le même lot, pas 9 litres.
      assert.deepEqual(parseQuantity('Lessive Lot de 3 x 1L').quantity, { amount: 3, unit: 'L' });
    });
  });

  describe('doses', () => {
    it('lit le nombre de lavages en plus du volume', () => {
      const parsed = parseQuantity('Ariel Lessive Liquide 1,5 L, 60 Lavages');
      assert.deepEqual(parsed.quantity, { amount: 1.5, unit: 'L' });
      assert.equal(parsed.doses, 60);
    });

    it('lit des capsules sans volume', () => {
      const parsed = parseQuantity('Finish Quantum Ultimate 40 capsules');
      assert.equal(parsed.quantity, null);
      assert.equal(parsed.doses, 40);
      assert.equal(isEmptyQuantity(parsed), false);
    });
  });

  describe('refus — la strictesse passe avant la couverture', () => {
    it('refuse un lot hétérogène plutôt que de choisir une contenance', () => {
      const parsed = parseQuantity('Coffret Lessive 1 L + Adoucissant 750 ml');
      assert.equal(parsed.quantity, null);
      assert.equal(parsed.ambiguous, true);
    });

    it('ne confond pas un chiffre du nom avec une contenance', () => {
      assert.equal(parseQuantity('Ariel 3en1 Pods Original').quantity, null);
      assert.equal(parseQuantity('Lessive 5 litres').quantity?.amount, 5);
    });

    it('ne prend pas le « l » de « liquide » pour un litre', () => {
      assert.equal(parseQuantity('Lessive liquide sans contenance').quantity, null);
      assert.equal(parseQuantity('Offre 2 lessives').quantity, null);
    });

    it('rend un résultat vide sur une entrée absente', () => {
      for (const input of [null, undefined, '', '   ']) {
        assert.equal(isEmptyQuantity(parseQuantity(input)), true);
      }
    });
  });
});

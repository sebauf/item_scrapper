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
      assert.deepEqual(parsed.unitQuantity, { amount: 1, unit: 'L' });
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
      assert.deepEqual(parsed.unitQuantity, { amount: 2, unit: 'L' });
    });

    it('ne multiplie pas deux fois un lot déjà écrit « N x »', () => {
      // « Lot de 3 » et « 3 x 1L » désignent le même lot, pas 9 litres.
      assert.deepEqual(parseQuantity('Lessive Lot de 3 x 1L').quantity, { amount: 3, unit: 'L' });
    });

    it('lit un multiplicateur entre parenthèses « (x6) »', () => {
      const parsed = parseQuantity('Lenor Adoucissant 1,36L (x6)');
      assert.equal(parsed.packSize, 6);
      assert.deepEqual(parsed.unitQuantity, { amount: 1.36, unit: 'L' });
      assert.deepEqual(parsed.quantity, { amount: 8.16, unit: 'L' });
    });

    it('ne prend pas la partie décimale d’un nombre pour un multiplicateur', () => {
      // « 2,5 x 1L » n'est pas un lot de 5, « 1,5L x 2,5 » pas un lot de 2.
      assert.equal(parseQuantity('Lessive 2,5 x 1L').packSize, null);
      assert.equal(parseQuantity('Lessive 1,5L x 2,5').packSize, null);
    });

    it('concilie une contenance unitaire et totale cohérentes', () => {
      const parsed = parseQuantity('Le Chat Lessive 2L - Lot de 2 (4L)');
      assert.deepEqual(parsed.unitQuantity, { amount: 2, unit: 'L' });
      assert.deepEqual(parsed.quantity, { amount: 4, unit: 'L' });
      assert.equal(parsed.ambiguous, false);
    });

    it('refuse un lot écrit avec deux nombres d’unités différents', () => {
      const parsed = parseQuantity('Lessive Lot de 2 - 3 x 1L');
      assert.equal(parsed.packSize, null);
      assert.equal(parsed.quantity, null);
      assert.equal(parsed.ambiguous, true);
    });

    it('refuse une contenance étrangère au lot « 3 x 1L »', () => {
      const parsed = parseQuantity('Persil 3 x 1L + Adoucissant 750 ml');
      assert.equal(parsed.quantity, null);
      assert.equal(parsed.ambiguous, true);
    });

    it('ne présume pas « vendu à l’unité » quand le titre se tait', () => {
      // `null` = le titre n'en dit rien ; seule la fiche peut établir « 1 ».
      assert.equal(parseQuantity('Ariel Lessive Liquide 1,5 L').packSize, null);
    });
  });

  describe('lots de doses — la boîte n’est pas le lot', () => {
    it('lit « 3 x 40 tablettes » comme trois boîtes de 40', () => {
      const parsed = parseQuantity('Finish Powerball Quantum 3 x 40 tablettes');
      assert.equal(parsed.packSize, 3);
      assert.equal(parsed.unitDoses, 40);
      assert.equal(parsed.doses, 120);
    });

    it('accepte l’écriture collée « 3x38 lavages »', () => {
      const parsed = parseQuantity('Ariel Pods Lessive en capsules, 3x38 lavages');
      assert.equal(parsed.packSize, 3);
      assert.equal(parsed.unitDoses, 38);
      assert.equal(parsed.doses, 114);
    });

    it('accepte le multiplicateur suffixe « 40 capsules x 3 »', () => {
      const parsed = parseQuantity('Finish Quantum 40 capsules x 3');
      assert.equal(parsed.packSize, 3);
      assert.equal(parsed.doses, 120);
    });

    it('accorde « Lot de 3 » et « 3 x 40 tablettes »', () => {
      const parsed = parseQuantity('Finish Quantum Ultimate Lot de 3 x 40 tablettes');
      assert.equal(parsed.packSize, 3);
      assert.equal(parsed.doses, 120);
      assert.equal(parsed.dosesAmbiguous, false);
    });

    it('concilie doses unitaires et totales quand le titre donne les deux', () => {
      const parsed = parseQuantity('Ariel lessive liquide 2,2L 40 lavages (Lot de 2) soit 80 lavages');
      assert.equal(parsed.packSize, 2);
      assert.equal(parsed.unitDoses, 40);
      assert.equal(parsed.doses, 80);
      assert.deepEqual(parsed.quantity, { amount: 4.4, unit: 'L' });
    });

    it('refuse un nombre de doses unique sur un lot : unité ou lot ?', () => {
      // Les deux lectures existent dans les titres réels : 40 lavages par
      // bouteille chez Le Chat, 60 pour les trois bouteilles chez Persil.
      for (const title of [
        'Le Chat Lessive Liquide 2L 40 lavages - Lot de 2',
        'Persil Lessive liquide 3 x 1L (60 lavages)',
      ]) {
        const parsed = parseQuantity(title);
        assert.equal(parsed.doses, null, title);
        assert.equal(parsed.unitDoses, null, title);
        assert.equal(parsed.dosesAmbiguous, true, title);
        assert.notEqual(parsed.quantity, null, `${title} : la contenance reste lisible`);
      }
    });

    it('refuse des doses incohérentes avec le lot écrit', () => {
      const parsed = parseQuantity('Finish 3 x 40 tablettes, 100 tablettes');
      assert.equal(parsed.doses, null);
      assert.equal(parsed.dosesAmbiguous, true);
    });
  });

  describe('doses', () => {
    it('lit le nombre de lavages en plus du volume', () => {
      const parsed = parseQuantity('Ariel Lessive Liquide 1,5 L, 60 Lavages');
      assert.deepEqual(parsed.quantity, { amount: 1.5, unit: 'L' });
      assert.equal(parsed.doses, 60);
    });

    it('refuse deux nombres de doses différents hors lot', () => {
      const parsed = parseQuantity('Lessive 60 lavages, 30 doses');
      assert.equal(parsed.doses, null);
      assert.equal(parsed.dosesAmbiguous, true);
    });

    it('lit des capsules sans volume', () => {
      const parsed = parseQuantity('Finish Quantum Ultimate 40 capsules');
      assert.equal(parsed.quantity, null);
      assert.equal(parsed.doses, 40);
      assert.equal(parsed.unitDoses, 40);
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

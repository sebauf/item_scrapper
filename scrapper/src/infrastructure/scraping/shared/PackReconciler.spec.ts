import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuantity } from './QuantityParser.js';
import { packFieldsChanged, reconcilePack, reparsePack } from './PackReconciler.js';

/**
 * La règle testée ici est celle qui empêche le faux rapprochement le plus
 * sournois : une bouteille et un lot de deux bouteilles qui portent le même
 * EAN. Le nombre d'unités n'est retenu que s'il est établi, et `1` ne l'est
 * que sur déclaration de la fiche.
 */
describe('PackReconciler', () => {
  describe('titre et fiche d’accord', () => {
    it('retient le lot du titre quand la fiche ne déclare rien', () => {
      const pack = reconcilePack(parseQuantity('Persil 3 x 1L'), null);
      assert.equal(pack.packSize, 3);
      assert.deepEqual(pack.quantity, { amount: 3, unit: 'L' });
      assert.deepEqual(pack.unitQuantity, { amount: 1, unit: 'L' });
      assert.equal(pack.issue, null);
    });

    it('retient le lot quand titre et fiche concordent', () => {
      const pack = reconcilePack(parseQuantity('Finish 3 x 40 tablettes'), 3);
      assert.equal(pack.packSize, 3);
      assert.equal(pack.doses, 120);
      assert.equal(pack.issue, null);
    });

    it('n’écrit « vendu à l’unité » que sur déclaration de la fiche', () => {
      const title = parseQuantity('Ariel Lessive Liquide 1,5 L, 60 Lavages');

      const declared = reconcilePack(title, 1);
      assert.equal(declared.packSize, 1);
      assert.deepEqual(declared.quantity, { amount: 1.5, unit: 'L' });
      assert.deepEqual(declared.unitQuantity, { amount: 1.5, unit: 'L' });
      assert.equal(declared.doses, 60);

      const silent = reconcilePack(title, null);
      assert.equal(silent.packSize, null, 'titre muet + fiche muette = inconnu, pas 1');
      assert.equal(silent.issue, null);
    });
  });

  describe('désaccords — on garde ce qui reste vrai, rien de plus', () => {
    it('annule lot et totaux quand titre et fiche se contredisent', () => {
      const pack = reconcilePack(parseQuantity('Le Chat Lessive 2L - Lot de 2'), 1);
      assert.equal(pack.packSize, null);
      assert.equal(pack.quantity, null);
      assert.equal(pack.doses, null);
      assert.equal(pack.issue, 'pack-conflict');
    });

    it('conserve les grandeurs unitaires, vraies dans les deux lectures', () => {
      const pack = reconcilePack(parseQuantity('Finish 3 x 40 tablettes'), 2);
      assert.equal(pack.unitDoses, 40);
      assert.equal(pack.doses, null);
    });

    it('ne devine pas la contenance unitaire d’un lot que le titre tait', () => {
      // « 4,5 L » : une bouteille de 4,5 L, ou trois de 1,5 L ?
      const pack = reconcilePack(parseQuantity('Skip Lessive Liquide 4,5 L'), 3);
      assert.equal(pack.packSize, 3);
      assert.equal(pack.quantity, null);
      assert.equal(pack.unitQuantity, null);
      assert.equal(pack.issue, 'per-unit-undetermined');
    });

    it('8 pièces annoncées et 8 articles déclarés : seul le total est sûr', () => {
      // Un blister de 8 brossettes, ou 8 brossettes à l'unité ? Les deux
      // lectures contiennent 8 pièces ; le nombre d'unités, lui, est indécidable.
      const pack = reconcilePack(parseQuantity('Oral-B CrossAction 8 Brossettes'), 8);
      assert.equal(pack.packSize, null);
      assert.equal(pack.doses, 8);
      assert.equal(pack.unitDoses, null);
      assert.equal(pack.issue, 'pieces-or-pack');
    });

    it('un nombre d’articles différent du nombre de pièces reste un lot déclaré', () => {
      const pack = reconcilePack(parseQuantity('Oral-B CrossAction 4 Brossettes'), 2);
      assert.equal(pack.packSize, 2);
      assert.equal(pack.issue, 'per-unit-undetermined');
    });

    it('ignore une déclaration qui n’est pas un entier positif', () => {
      const title = parseQuantity('Persil 3 x 1L');
      for (const declared of [0, -2, 1.5, Number.NaN]) {
        const pack = reconcilePack(title, declared);
        assert.equal(pack.packSize, 3, String(declared));
        assert.equal(pack.issue, null, String(declared));
      }
    });
  });
});

describe('PackReconciler — recalcul de l’historique', () => {
  it('défait un faux lot écrit par un parseur antérieur', () => {
    // Avant que les brossettes ne soient reconnues, « Pack de 4 » était lu
    // comme un lot de 4. La règle « dernière valeur non nulle » l'aurait
    // conservé indéfiniment : seul un recalcul l'efface.
    const before = { packSize: 4, quantity: null, unitQuantity: null, doses: null, unitDoses: null };
    const after = reparsePack('Oral-B Pro CrossAction Pack de 4 Brossettes', null);
    assert.deepEqual(after, { packSize: null, quantity: null, unitQuantity: null, doses: 4, unitDoses: 4 });
    assert.equal(packFieldsChanged(before, after), true);
  });

  it('reprend le nombre d’articles déclaré que le relevé a conservé', () => {
    assert.equal(reparsePack('Ariel Lessive 1,5 L', 1).packSize, 1);
    assert.equal(reparsePack('Ariel Lessive 1,5 L', null).packSize, null);
  });

  it('ne réécrit pas un relevé déjà à jour, champs absents compris', () => {
    const next = reparsePack('Persil 3 x 1L', null);
    assert.equal(packFieldsChanged({ ...next }, next), false);
    // Relevé antérieur à l'extraction : aucun champ, tout à null après calcul.
    assert.equal(packFieldsChanged({}, reparsePack('Titre sans contenance', null)), false);
    assert.equal(packFieldsChanged({}, next), true);
  });

  it('compare les contenances par valeur', () => {
    const next = reparsePack('Ariel Lessive 1,5 L', 1);
    const stored = { ...next, quantity: { amount: 1.5, unit: 'L' as const } };
    assert.equal(packFieldsChanged(stored, next), false);
  });
});

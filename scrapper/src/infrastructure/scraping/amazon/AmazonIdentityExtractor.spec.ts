import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeLabels } from './AmazonIdentityExtractor.js';

/**
 * Seule la partie pure de l'extracteur est testée ici : le reste parle au
 * navigateur. Les libellés relevés servent au diagnostic — c'est par eux
 * qu'on verra si Amazon écrit « Nombre d'articles » autrement.
 */
describe('AmazonIdentityExtractor — libellés de diagnostic', () => {
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

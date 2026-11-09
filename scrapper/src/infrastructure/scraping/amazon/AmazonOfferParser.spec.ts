import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OWN_PRICE_CONTAINERS, OWN_PRICE_SELECTORS, isUnavailable } from './AmazonOfferParser.js';

describe('AmazonOfferParser', () => {
  describe('disponibilité', () => {
    it("reconnaît une fiche sans offre, quelle qu'en soit la mise en forme", () => {
      assert.equal(isUnavailable('Actuellement indisponible.'), true);
      assert.equal(
        isUnavailable(
          "\n  Actuellement indisponible.\n   Nous ne savons pas quand cet article sera de nouveau approvisionné ni s'il le sera.",
        ),
        true,
      );
      assert.equal(isUnavailable('ACTUELLEMENT INDISPONIBLE'), true);
      assert.equal(isUnavailable('Currently unavailable.'), true);
    });

    it('garde les offres achetables, même en rupture temporaire', () => {
      assert.equal(isUnavailable('En stock'), false);
      assert.equal(isUnavailable('Il ne reste plus que 3 exemplaire(s) en stock.'), false);
      assert.equal(
        isUnavailable('Temporairement en rupture de stock. Commandez maintenant et nous vous livrerons cet article lorsqu\'il sera disponible.'),
        false,
      );
      assert.equal(isUnavailable('Habituellement expédié sous 1 à 2 mois.'), false);
      assert.equal(isUnavailable('Disponible auprès de ces vendeurs.'), false);
    });

    it("ne conclut rien d'un bloc absent", () => {
      assert.equal(isUnavailable(null), false);
      assert.equal(isUnavailable(''), false);
    });
  });

  describe('sélecteurs de prix', () => {
    it("ne lisent un prix qu'à l'intérieur des blocs de l'article lui-même", () => {
      for (const selectorList of OWN_PRICE_SELECTORS) {
        for (const selector of selectorList.split(',').map((part) => part.trim())) {
          assert.ok(
            OWN_PRICE_CONTAINERS.some((container) => selector.startsWith(`${container} `)),
            `sélecteur non restreint : ${selector}`,
          );
        }
      }
    });
  });
});

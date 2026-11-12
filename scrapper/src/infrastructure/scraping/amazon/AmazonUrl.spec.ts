import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { absoluteUrl, asinOf, isBlockPage, isDeadProductRedirect, productUrl, variantUrls } from './AmazonUrl.js';

const FICHE = 'https://www.amazon.fr/Finish-Powerball-Quantum-Lave-Vaisselle-Tablettes/dp/B0CZ1TL7XK/ref=sr_1_3?keywords=finish';

describe('AmazonUrl', () => {
  it("lit l'ASIN d'une fiche, avec ou sans titre dans le chemin", () => {
    assert.equal(asinOf(FICHE), 'B0CZ1TL7XK');
    assert.equal(asinOf('https://www.amazon.fr/dp/B0GNSHRHV2/'), 'B0GNSHRHV2');
    assert.equal(asinOf('https://www.amazon.fr/s?k=lessive'), null);
  });

  it("construit l'URL canonique d'une fiche", () => {
    assert.equal(productUrl('B0CZ1TL7XK'), 'https://www.amazon.fr/dp/B0CZ1TL7XK/');
  });

  it('rend absolus les liens relatifs de la page, et seulement eux', () => {
    assert.equal(absoluteUrl('/s?k=lessive&page=2'), 'https://www.amazon.fr/s?k=lessive&page=2');
    assert.equal(absoluteUrl('https://www.amazon.fr/s?k=x'), 'https://www.amazon.fr/s?k=x');
  });

  it('reconnaît les pages de blocage', () => {
    assert.equal(isBlockPage('https://www.amazon.fr/errors/validateCaptcha?amzn=x'), true);
    assert.equal(isBlockPage('https://www.amazon.fr/ap/signin?openid.return_to=x'), true);
    assert.equal(isBlockPage(FICHE), false);
  });

  describe('fiche disparue', () => {
    it("une fiche redirigée vers l'accueil ou une recherche est morte", () => {
      assert.equal(isDeadProductRedirect(FICHE, 'https://www.amazon.fr/'), true);
      assert.equal(isDeadProductRedirect(FICHE, 'https://www.amazon.fr/s?k=finish'), true);
    });

    it('une redirection vers un captcha ne prouve rien', () => {
      assert.equal(isDeadProductRedirect(FICHE, 'https://www.amazon.fr/errors/validateCaptcha'), false);
    });

    it("une fiche qui aboutit sur une fiche, même autre, n'est pas morte", () => {
      assert.equal(isDeadProductRedirect(FICHE, FICHE), false);
      assert.equal(isDeadProductRedirect(FICHE, 'https://www.amazon.fr/dp/B0GNSHRHV2/'), false);
    });

    it("ne conclut rien d'une requête qui n'était pas une fiche", () => {
      assert.equal(isDeadProductRedirect('https://www.amazon.fr/s?k=x', 'https://www.amazon.fr/'), false);
    });
  });

  it("lit l'ASIN quelle que soit la casse du lien", () => {
    assert.equal(asinOf('https://www.amazon.fr/DP/B0CZ1TL7XK'), 'B0CZ1TL7XK');
  });

  describe('déclinaisons', () => {
    it("garde l'ordre de la page, sans doublon ni la fiche courante", () => {
      const urls = variantUrls(
        ['B0CZ1TL7XK', 'B0GNSHRHV2', ''],
        ['/Finish-Quantum/dp/B0GNSHRHV2/ref=twister', '/dp/B07XYZ1234?th=1', '/gp/help'],
        'B0CZ1TL7XK',
      );
      assert.deepEqual(urls, [
        'https://www.amazon.fr/dp/B0GNSHRHV2/',
        'https://www.amazon.fr/dp/B07XYZ1234/',
      ]);
    });

    it('rien sans sélecteur de déclinaisons', () => {
      assert.deepEqual(variantUrls([], [], 'B0CZ1TL7XK'), []);
    });
  });
});

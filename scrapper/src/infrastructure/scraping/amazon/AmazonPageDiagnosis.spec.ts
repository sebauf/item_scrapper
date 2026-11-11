import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { diagnosePage, isBlockUrl, type PageEvidence } from './AmazonPageDiagnosis.js';

const PRODUCT_URL = 'https://www.amazon.fr/dp/B0ABCDEFGH/';
const LONG_TEXT = 'Livraison GRATUITE '.repeat(20);

type EvidenceOverrides = Partial<Omit<PageEvidence, 'markers'>> & {
  markers?: Partial<PageEvidence['markers']>;
};

function evidence(overrides: EvidenceOverrides = {}): PageEvidence {
  const { markers, ...rest } = overrides;
  return {
    finalUrl: PRODUCT_URL,
    httpStatus: 200,
    documentTitle: 'Amazon.fr',
    bodyText: LONG_TEXT,
    htmlLength: 500_000,
    ...rest,
    markers: { captchaForm: false, productLayout: false, searchLayout: false, searchResults: 0, ...markers },
  };
}

describe('AmazonPageDiagnosis', () => {
  describe('blocages : réessayés avec une nouvelle session', () => {
    it('reconnaît la redirection vers la connexion', () => {
      const d = diagnosePage(evidence({ finalUrl: 'https://www.amazon.fr/ap/signin?openid=x' }), 'product');
      assert.equal(d.reason, 'sign_in');
      assert.equal(d.retryable, true);
      assert.equal(d.rotateSession, true);
    });

    it("reconnaît le captcha par l'URL, par le formulaire ou par le texte", () => {
      for (const e of [
        evidence({ finalUrl: 'https://www.amazon.fr/errors/validateCaptcha?amzn=x' }),
        evidence({ markers: { captchaForm: true } }),
        evidence({ bodyText: "Saisissez les caractères que vous voyez ci-dessous. Désolés, nous devons simplement nous assurer que vous n'êtes pas un robot." }),
        evidence({ bodyText: 'Cliquez sur le bouton ci-dessous pour continuer vos achats. Continuer les achats' }),
        evidence({ bodyText: 'Enter the characters you see below' }),
      ]) {
        const d = diagnosePage(e, 'product');
        assert.equal(d.reason, 'captcha', e.bodyText);
        assert.equal(d.rotateSession, true);
        assert.equal(d.retryable, true);
      }
    });

    it("le formulaire de captcha l'emporte sur un statut d'erreur", () => {
      assert.equal(diagnosePage(evidence({ httpStatus: 503, markers: { captchaForm: true } }), 'product').reason, 'captcha');
    });

    it('classe 429 et 503 comme un refus de servir', () => {
      for (const httpStatus of [429, 503]) {
        const d = diagnosePage(evidence({ httpStatus }), 'product');
        assert.equal(d.reason, 'rate_limited');
        assert.equal(d.rotateSession, true);
      }
    });

    it("classe la page « une erreur s'est produite » servie en 200", () => {
      const d = diagnosePage(evidence({ bodyText: "Désolé ! Une erreur s'est produite de notre côté." }), 'product');
      assert.equal(d.reason, 'rate_limited');
    });
  });

  describe('fiche supprimée : pas de nouvelle tentative', () => {
    it('par le statut HTTP', () => {
      for (const httpStatus of [404, 410]) {
        const d = diagnosePage(evidence({ httpStatus }), 'product');
        assert.equal(d.reason, 'not_found');
        assert.equal(d.retryable, false);
      }
    });

    it('par le texte de la page « introuvable »', () => {
      const d = diagnosePage(
        evidence({ bodyText: "Nous sommes désolés. L'adresse Web que vous avez entrée n'est pas une page active de notre site." }),
        'product',
      );
      assert.equal(d.reason, 'not_found');
    });
  });

  describe('refonte de la page : le code est en cause, pas la page', () => {
    it("une fiche reconnue sans titre lisible n'est pas réessayée et garde son HTML", () => {
      const d = diagnosePage(evidence({ markers: { productLayout: true } }), 'product');
      assert.equal(d.reason, 'layout_changed');
      assert.equal(d.retryable, false);
      assert.equal(d.keepSnapshot, true);
    });

    it("le squelette de fiche l'emporte sur un texte trompeur", () => {
      const d = diagnosePage(
        evidence({ markers: { productLayout: true }, bodyText: `${LONG_TEXT} Continuer vos achats` }),
        'product',
      );
      assert.equal(d.reason, 'layout_changed');
    });

    it('une page de résultats sans résultat lisible signale des sélecteurs obsolètes', () => {
      const d = diagnosePage(evidence({ markers: { searchLayout: true } }), 'search');
      assert.equal(d.reason, 'layout_changed');
    });

    it("le squelette de recherche ne compte pas pour une fiche, ni l'inverse", () => {
      assert.equal(diagnosePage(evidence({ markers: { searchLayout: true } }), 'product').reason, 'unknown');
      assert.equal(diagnosePage(evidence({ markers: { productLayout: true } }), 'search').reason, 'unknown');
    });
  });

  it('cherche les motifs dans tout le texte, au-delà de l\'en-tête de navigation', () => {
    const d = diagnosePage(
      evidence({ markers: { searchLayout: true }, bodyText: `${'Menu '.repeat(2000)} Aucun résultat pour « zzqxw ».` }),
      'search',
    );
    assert.equal(d.reason, 'no_results');
  });

  it("distingue une recherche vide d'une recherche illisible", () => {
    const d = diagnosePage(
      evidence({ markers: { searchLayout: true }, bodyText: 'Aucun résultat pour « zzqxw ».' }),
      'search',
    );
    assert.equal(d.reason, 'no_results');
    assert.equal(d.retryable, false);
  });

  it('réessaie une page vide', () => {
    const d = diagnosePage(evidence({ bodyText: '', htmlLength: 39 }), 'product');
    assert.equal(d.reason, 'empty_page');
    assert.equal(d.retryable, true);
    assert.equal(d.rotateSession, false);
  });

  it("réessaie les erreurs serveur, pas les erreurs client", () => {
    assert.deepEqual(
      [500, 502, 400, 451].map((httpStatus) => diagnosePage(evidence({ httpStatus }), 'product')),
      [500, 502, 400, 451].map((httpStatus) => ({
        reason: 'http_error',
        detail: `HTTP ${httpStatus}`,
        retryable: httpStatus >= 500,
        rotateSession: false,
        keepSnapshot: false,
      })),
    );
  });

  it('garde le HTML de toute page non reconnue, et la réessaie', () => {
    const d = diagnosePage(evidence({ documentTitle: 'Amazon Fresh' }), 'product');
    assert.equal(d.reason, 'unknown');
    assert.equal(d.retryable, true);
    assert.equal(d.keepSnapshot, true);
    assert.match(d.detail, /Amazon Fresh/);
  });

  it("isBlockUrl ne confond pas une fiche avec une page de blocage", () => {
    assert.equal(isBlockUrl(PRODUCT_URL), false);
    assert.equal(isBlockUrl('https://www.amazon.fr/ap/cvf/request'), true);
    assert.equal(isBlockUrl('https://www.amazon.fr/errors/validateCaptcha'), true);
  });
});

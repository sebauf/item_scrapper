import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatDashboard,
  formatHistory,
  formatKeywordSummaries,
  formatProductDetail,
  formatProductSummary,
  formatSearchResult,
} from './format.js';
import { aDashboard, aProduct, aProductDetail, aScoredProduct } from './testing/fixtures.js';

describe('formatProductSummary', () => {
  // L'id opaque est la seule clé qui permet ensuite d'appeler get_product :
  // l'oublier rendrait la recherche stérile.
  it("expose toujours l'identifiant du produit", () => {
    assert.match(formatProductSummary(aProduct()), /id: aHR0cHM6Ly9leGVtcGxl/);
  });

  it('signale un produit sans score au lieu de le taire', () => {
    assert.match(formatProductSummary(aProduct()), /pas encore de score/);
  });

  it("annonce le verdict du serveur, sans le recalculer", () => {
    const text = formatProductSummary(aScoredProduct());

    assert.match(text, /BONNE AFFAIRE/);
    assert.match(text, /\+18\.4% vs prix attendu/);
    assert.match(text, /tendance down/);
  });

  it("n'écrit « bonne affaire » que si le serveur l'a décidé", () => {
    // Un score positif sous le seuil : isDeal fait foi, pas le signe du score.
    const text = formatProductSummary(aScoredProduct({ dealScore: 2, isDeal: false }));

    assert.match(text, /pas une affaire/);
    assert.doesNotMatch(text, /BONNE AFFAIRE/);
  });

  it('mentionne le prix barré quand il existe', () => {
    const text = formatProductSummary(
      aProduct({ crossedOutPrice: { amount: 19.99, currency: 'EUR' } }),
    );

    assert.match(text, /barré 19\.99 EUR/);
  });

  it('supporte un prix absent', () => {
    assert.match(formatProductSummary(aProduct({ price: null })), /prix inconnu/);
  });
});

describe('formatHistory', () => {
  it('tronque aux relevés les plus récents', () => {
    const history = aProductDetail().history;

    const text = formatHistory(history, 2);

    assert.match(text, /2026-08-08/);
    assert.match(text, /2026-08-07/);
    assert.doesNotMatch(text, /2026-08-06/);
    assert.match(text, /3 relevés, les 2 plus récents affichés/);
  });

  it('gère un produit sans historique', () => {
    assert.equal(formatHistory([], 30), 'Aucun historique de prix.');
  });
});

describe('formatProductDetail', () => {
  it('joint la fiche et son historique', () => {
    const text = formatProductDetail(aProductDetail(), 30);

    assert.match(text, /suivi du 2026-06-01 au 2026-08-08/);
    assert.match(text, /Historique de prix/);
  });
});

describe('formatKeywordSummaries', () => {
  it('oriente vers track_keyword quand rien n\'est suivi', () => {
    assert.match(formatKeywordSummaries([]), /track_keyword/);
  });

  it('affiche « jamais » plutôt qu\'une date vide', () => {
    const text = formatKeywordSummaries([
      { keyword: 'café en grains', productCount: 0, lastScrape: null },
    ]);

    assert.match(text, /dernier scrape jamais/);
  });
});

describe('formatSearchResult', () => {
  it('rappelle les totaux du mot-clé, filtres exclus', () => {
    const text = formatSearchResult(
      'lessive liquide',
      { items: [aScoredProduct()], total: 1, pageCount: 1, keywordTotal: 42, keywordDealCount: 3 },
      1,
    );

    assert.match(text, /42 produit\(s\) suivis dont 3 bonne\(s\) affaire\(s\)/);
    assert.match(text, /1 résultat\(s\), page 1\/1/);
  });

  // Un mot-clé inconnu renvoie 200 avec des compteurs à zéro : le texte doit
  // le dire clairement, sinon l'agent conclut à une panne.
  it('rend explicite une page vide', () => {
    const text = formatSearchResult(
      'inconnu',
      { items: [], total: 0, pageCount: 0, keywordTotal: 0, keywordDealCount: 0 },
      1,
    );

    assert.match(text, /Aucun produit sur cette page/);
    assert.match(text, /page 1\/1/);
  });
});

describe('formatDashboard', () => {
  it('résume les compteurs et les affaires par mot-clé', () => {
    const text = formatDashboard(aDashboard());

    assert.match(text, /Produits suivis : 42/);
    assert.match(text, /Dernière mise à jour du pipeline : 2026-08-08/);
    assert.match(text, /## lessive liquide — 3 affaire\(s\) sur 42 produit\(s\)/);
  });

  it('gère un tableau de bord vide', () => {
    const text = formatDashboard(
      aDashboard({ keywordCount: 0, productCount: 0, dealCount: 0, lastUpdate: null, dealsByKeyword: [] }),
    );

    assert.match(text, /Aucune bonne affaire à signaler/);
    assert.match(text, /Dernière mise à jour du pipeline : jamais/);
  });
});

import { InvalidProductUrl } from './product-tracking.errors';
import { ProductUrl } from './product-url';

describe('ProductUrl', () => {
  it('accepte une URL amazon.fr avec ASIN et la canonicalise', () => {
    const url = ProductUrl.create('https://www.amazon.fr/Some-Title/dp/b0abcdefgh/?ref=xyz');
    expect(url.value).toBe('https://www.amazon.fr/dp/B0ABCDEFGH/');
  });

  it('accepte amazon.fr sans www', () => {
    const url = ProductUrl.create('https://amazon.fr/dp/B0ABCDEFGH');
    expect(url.value).toBe('https://www.amazon.fr/dp/B0ABCDEFGH/');
  });

  it('rejette une entrée non-string', () => {
    expect(() => ProductUrl.create(42)).toThrow(InvalidProductUrl);
  });

  it('rejette une URL mal formée', () => {
    expect(() => ProductUrl.create('pas-une-url')).toThrow(InvalidProductUrl);
  });

  it('rejette un protocole non http(s)', () => {
    expect(() => ProductUrl.create('ftp://amazon.fr/dp/B0ABCDEFGH')).toThrow(InvalidProductUrl);
  });

  it('rejette un domaine autre que amazon.fr', () => {
    expect(() => ProductUrl.create('https://www.amazon.de/dp/B0ABCDEFGH')).toThrow(
      InvalidProductUrl,
    );
  });

  it("rejette une URL amazon.fr sans ASIN (page de recherche)", () => {
    expect(() => ProductUrl.create('https://www.amazon.fr/s?k=lessive')).toThrow(
      InvalidProductUrl,
    );
  });

  it('deux URLs pointant vers le même ASIN sont égales une fois canonicalisées', () => {
    const a = ProductUrl.create('https://www.amazon.fr/dp/B0ABCDEFGH/ref=sr_1_1');
    const b = ProductUrl.create('https://www.amazon.fr/Titre-Produit/dp/B0ABCDEFGH');
    expect(a.equals(b)).toBe(true);
  });
});

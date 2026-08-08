import { InvalidProductId } from './catalog.errors';
import { ProductId } from './product-id';

const URL = 'https://www.amazon.fr/dp/B0CZ1TL7XK?th=1&psc=1';

describe('ProductId', () => {
  it('fait un aller-retour sans perte', () => {
    const encoded = ProductId.fromUrl(URL).value;
    expect(ProductId.fromEncoded(encoded).url).toBe(URL);
  });

  it("n'encode que des caractères sûrs pour un chemin HTTP", () => {
    expect(ProductId.fromUrl(URL).value).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('gère les URL contenant de l’UTF-8', () => {
    const accented = 'https://www.amazon.fr/lessive-liquide-écologique/dp/B0XYZ';
    expect(ProductId.fromEncoded(ProductId.fromUrl(accented).value).url).toBe(accented);
  });

  it.each([
    ['une chaîne vide', ''],
    ['un caractère hors alphabet', 'abc/def'],
    ['du padding base64 classique', 'aHR0cHM6Ly9hLmZy=='],
  ])('refuse %s', (_label, encoded) => {
    expect(() => ProductId.fromEncoded(encoded)).toThrow(InvalidProductId);
  });

  it('refuse un identifiant trop long', () => {
    expect(() => ProductId.fromEncoded('a'.repeat(2049))).toThrow(/2048/);
  });

  it("refuse une valeur décodable qui n'est pas une URL http(s)", () => {
    const encoded = Buffer.from('file:///etc/passwd', 'utf8').toString('base64url');
    expect(() => ProductId.fromEncoded(encoded)).toThrow(/URL http/);
  });

  it('compare par URL', () => {
    expect(ProductId.fromUrl(URL).equals(ProductId.fromEncoded(ProductId.fromUrl(URL).value))).toBe(
      true,
    );
  });
});

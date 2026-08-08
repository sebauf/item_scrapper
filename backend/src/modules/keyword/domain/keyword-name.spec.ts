import { KeywordName } from './keyword-name';
import { InvalidKeywordName } from './keyword.errors';

describe('KeywordName', () => {
  it('normalise les espaces de bordure', () => {
    expect(KeywordName.create('  lessive liquide  ').value).toBe('lessive liquide');
  });

  it('accepte exactement MAX_LENGTH caractères', () => {
    const name = 'a'.repeat(KeywordName.MAX_LENGTH);
    expect(KeywordName.create(name).value).toBe(name);
  });

  it.each([
    ['une chaîne vide', ''],
    ['des espaces seuls', '   '],
    ['une tabulation seule', '\t\n'],
  ])('refuse %s', (_label, raw) => {
    expect(() => KeywordName.create(raw)).toThrow(InvalidKeywordName);
  });

  it('refuse au-delà de MAX_LENGTH, après trim', () => {
    expect(() => KeywordName.create(` ${'a'.repeat(KeywordName.MAX_LENGTH + 1)} `)).toThrow(
      /trop long/i,
    );
  });

  it.each([[null], [undefined], [42], [{}], [['x']]])('refuse le non-string %p', (raw) => {
    expect(() => KeywordName.create(raw)).toThrow(InvalidKeywordName);
  });

  it('compare par valeur, pas par référence', () => {
    expect(KeywordName.create('savon').equals(KeywordName.create(' savon '))).toBe(true);
    expect(KeywordName.create('savon').equals(KeywordName.create('Savon'))).toBe(false);
  });
});

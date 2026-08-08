import { Keyword } from './keyword';
import { KeywordName } from './keyword-name';
import { KeywordAlreadyTracked } from './keyword.errors';

const name = KeywordName.create('adoucissant');

describe('Keyword', () => {
  it('naît suivi', () => {
    expect(Keyword.track(name).isTracked).toBe(true);
  });

  it('refuse de suivre un mot-clé déjà suivi', () => {
    const keyword = Keyword.rehydrate(name, true);
    expect(() => keyword.retrack()).toThrow(KeywordAlreadyTracked);
    expect(keyword.isTracked).toBe(true);
  });

  it('réactive un mot-clé retiré', () => {
    const keyword = Keyword.rehydrate(name, false);
    keyword.retrack();
    expect(keyword.isTracked).toBe(true);
  });

  it('retire un mot-clé suivi', () => {
    const keyword = Keyword.rehydrate(name, true);
    keyword.untrack();
    expect(keyword.isTracked).toBe(false);
  });

  it('accepte de retirer un mot-clé déjà retiré (idempotence du DELETE)', () => {
    const keyword = Keyword.rehydrate(name, false);
    expect(() => keyword.untrack()).not.toThrow();
    expect(keyword.isTracked).toBe(false);
  });
});

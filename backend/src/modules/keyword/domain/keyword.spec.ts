import { UserId } from 'src/shared/domain/user-id';
import { Keyword } from './keyword';
import { KeywordName } from './keyword-name';
import { KeywordAlreadyTracked } from './keyword.errors';

const alice = UserId.create('alice@example.com');
const name = KeywordName.create('adoucissant');

describe('Keyword', () => {
  it('naît suivi par son propriétaire', () => {
    const keyword = Keyword.track(alice, name);

    expect(keyword.isTracked).toBe(true);
    expect(keyword.owner).toBe(alice);
  });

  it('refuse de suivre un mot-clé déjà suivi', () => {
    const keyword = Keyword.rehydrate(alice, name, true);
    expect(() => keyword.retrack()).toThrow(KeywordAlreadyTracked);
    expect(keyword.isTracked).toBe(true);
  });

  it('réactive un mot-clé retiré', () => {
    const keyword = Keyword.rehydrate(alice, name, false);
    keyword.retrack();
    expect(keyword.isTracked).toBe(true);
  });

  it('retire un mot-clé suivi', () => {
    const keyword = Keyword.rehydrate(alice, name, true);
    keyword.untrack();
    expect(keyword.isTracked).toBe(false);
  });

  it('accepte de retirer un mot-clé déjà retiré (idempotence du DELETE)', () => {
    const keyword = Keyword.rehydrate(alice, name, false);
    expect(() => keyword.untrack()).not.toThrow();
    expect(keyword.isTracked).toBe(false);
  });
});

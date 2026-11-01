import { UserId } from 'src/shared/domain/user-id';
import { ProductUrl } from './product-url';
import { ProductUrlAlreadyTracked } from './product-tracking.errors';
import { TrackedUrl } from './tracked-url';

const alice = UserId.create('alice@example.com');
const url = ProductUrl.create('https://www.amazon.fr/dp/B0ABCDEFGH/');

describe('TrackedUrl', () => {
  it('naît suivie', () => {
    expect(TrackedUrl.track(alice, url).isTracked).toBe(true);
  });

  it('refuse de suivre une URL déjà suivie', () => {
    const tracked = TrackedUrl.rehydrate(alice, url, true);
    expect(() => tracked.retrack()).toThrow(ProductUrlAlreadyTracked);
    expect(tracked.isTracked).toBe(true);
  });

  it('réactive une URL retirée', () => {
    const tracked = TrackedUrl.rehydrate(alice, url, false);
    tracked.retrack();
    expect(tracked.isTracked).toBe(true);
  });

  it('retire une URL suivie', () => {
    const tracked = TrackedUrl.rehydrate(alice, url, true);
    tracked.untrack();
    expect(tracked.isTracked).toBe(false);
  });

  it('accepte de retirer une URL déjà retirée (idempotence du DELETE)', () => {
    const tracked = TrackedUrl.rehydrate(alice, url, false);
    expect(() => tracked.untrack()).not.toThrow();
    expect(tracked.isTracked).toBe(false);
  });
});

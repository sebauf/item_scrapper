import { ProductUrl } from './product-url';
import { ProductUrlAlreadyTracked } from './product-tracking.errors';
import { TrackedUrl } from './tracked-url';

const url = ProductUrl.create('https://www.amazon.fr/dp/B0ABCDEFGH/');

describe('TrackedUrl', () => {
  it('naît suivie', () => {
    expect(TrackedUrl.track(url).isTracked).toBe(true);
  });

  it('refuse de suivre une URL déjà suivie', () => {
    const tracked = TrackedUrl.rehydrate(url, true);
    expect(() => tracked.retrack()).toThrow(ProductUrlAlreadyTracked);
    expect(tracked.isTracked).toBe(true);
  });

  it('réactive une URL retirée', () => {
    const tracked = TrackedUrl.rehydrate(url, false);
    tracked.retrack();
    expect(tracked.isTracked).toBe(true);
  });

  it('retire une URL suivie', () => {
    const tracked = TrackedUrl.rehydrate(url, true);
    tracked.untrack();
    expect(tracked.isTracked).toBe(false);
  });

  it('accepte de retirer une URL déjà retirée (idempotence du DELETE)', () => {
    const tracked = TrackedUrl.rehydrate(url, false);
    expect(() => tracked.untrack()).not.toThrow();
    expect(tracked.isTracked).toBe(false);
  });
});

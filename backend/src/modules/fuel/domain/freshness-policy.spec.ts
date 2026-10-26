import { isStale, STALE_AFTER_HOURS } from './freshness-policy';

describe('isStale', () => {
  const now = new Date('2026-10-26T12:00:00.000Z');
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);

  it('un prix déclaré dans le délai est frais', () => {
    expect(isStale(hoursAgo(1), now)).toBe(false);
  });

  it('un prix déclaré pile au seuil est encore frais', () => {
    expect(isStale(hoursAgo(STALE_AFTER_HOURS), now)).toBe(false);
  });

  it('au-delà du seuil, le prix est signalé', () => {
    expect(isStale(hoursAgo(STALE_AFTER_HOURS + 1), now)).toBe(true);
  });

  it('un prix sans date de déclaration est signalé : rien ne l’atteste', () => {
    expect(isStale(null, now)).toBe(true);
  });
});

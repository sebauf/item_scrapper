import {
  LIKELY_RESTOCK_THRESHOLD,
  POSSIBLE_RESTOCK_THRESHOLD,
  restockLevel,
  restockOutlook,
} from './restock-forecast-policy';
import { FORECAST_MAX_AGE_HOURS } from './shortage-forecast-policy';

describe('restock forecast policy', () => {
  const now = new Date('2026-11-05T12:00:00.000Z');
  const computedAt = new Date('2026-11-05T11:30:00.000Z');
  const since = new Date('2026-11-05T08:00:00.000Z');

  it('classe la chance aux seuils, bornes incluses', () => {
    expect(restockLevel(0)).toBe('unlikely');
    expect(restockLevel(POSSIBLE_RESTOCK_THRESHOLD - 0.001)).toBe('unlikely');
    expect(restockLevel(POSSIBLE_RESTOCK_THRESHOLD)).toBe('possible');
    expect(restockLevel(LIKELY_RESTOCK_THRESHOLD - 0.001)).toBe('possible');
    expect(restockLevel(LIKELY_RESTOCK_THRESHOLD)).toBe('likely');
  });

  it('la date prévisionnelle est la fin de l’horizon de 24 h', () => {
    expect(restockOutlook({ probability: 0.71, computedAt }, false, since, now)).toEqual({
      probability: 0.71,
      level: 'likely',
      computedAt,
      horizonEnd: new Date('2026-11-06T11:30:00.000Z'),
    });
  });

  it('rien pour un carburant disponible', () => {
    expect(restockOutlook({ probability: 0.9, computedAt }, true, null, now)).toBeNull();
  });

  it('rien sans prévision publiée', () => {
    expect(restockOutlook(null, false, since, now)).toBeNull();
  });

  it('écarte une prévision trop ancienne, garde celle à la limite', () => {
    const limit = new Date(now.getTime() - FORECAST_MAX_AGE_HOURS * 3_600_000);
    expect(restockOutlook({ probability: 0.3, computedAt: limit }, false, null, now)).not.toBeNull();
    expect(
      restockOutlook({ probability: 0.3, computedAt: new Date(limit.getTime() - 1) }, false, null, now),
    ).toBeNull();
  });

  it('écarte une prévision calculée avant le début de la rupture en cours', () => {
    const restarted = new Date(computedAt.getTime() + 60_000);
    expect(restockOutlook({ probability: 0.8, computedAt }, false, restarted, now)).toBeNull();
    expect(restockOutlook({ probability: 0.8, computedAt }, false, computedAt, now)).not.toBeNull();
  });
});

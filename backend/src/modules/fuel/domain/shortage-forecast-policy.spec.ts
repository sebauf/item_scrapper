import {
  ELEVATED_SHORTAGE_THRESHOLD,
  FORECAST_MAX_AGE_HOURS,
  LIKELY_SHORTAGE_THRESHOLD,
  riskLevel,
  shortageOutlook,
} from './shortage-forecast-policy';

describe('shortage forecast policy', () => {
  const now = new Date('2026-11-05T12:00:00.000Z');
  const computedAt = new Date('2026-11-05T11:30:00.000Z');

  it('classe le risque aux seuils, bornes incluses', () => {
    expect(riskLevel(0)).toBe('low');
    expect(riskLevel(ELEVATED_SHORTAGE_THRESHOLD - 0.001)).toBe('low');
    expect(riskLevel(ELEVATED_SHORTAGE_THRESHOLD)).toBe('elevated');
    expect(riskLevel(LIKELY_SHORTAGE_THRESHOLD - 0.001)).toBe('elevated');
    expect(riskLevel(LIKELY_SHORTAGE_THRESHOLD)).toBe('likely');
  });

  it('la date prévisionnelle est la fin de l’horizon de 24 h', () => {
    expect(shortageOutlook({ risk: 0.62, computedAt }, true, now)).toEqual({
      risk: 0.62,
      level: 'likely',
      computedAt,
      horizonEnd: new Date('2026-11-06T11:30:00.000Z'),
    });
  });

  it('rien sans prévision publiée', () => {
    expect(shortageOutlook(null, true, now)).toBeNull();
  });

  it('rien pour un carburant déjà en rupture', () => {
    expect(shortageOutlook({ risk: 0.9, computedAt }, false, now)).toBeNull();
  });

  it('écarte une prévision trop ancienne, garde celle à la limite', () => {
    const limit = new Date(now.getTime() - FORECAST_MAX_AGE_HOURS * 3_600_000);
    expect(shortageOutlook({ risk: 0.3, computedAt: limit }, true, now)).not.toBeNull();
    expect(
      shortageOutlook({ risk: 0.3, computedAt: new Date(limit.getTime() - 1) }, true, now),
    ).toBeNull();
  });
});

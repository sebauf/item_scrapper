import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDate, formatDateTime, formatDayMonth, formatPrice, timeAgo } from './format';

/**
 * Deux fonctions d'affichage, deux pièges : une devise inconnue ne doit pas
 * faire tomber une page entière, et « il y a » doit rester juste aux bornes.
 */
describe('formatPrice', () => {
  it('formate en euros à la française', () => {
    // L'espace avant le symbole est une espace insécable : on ne teste donc pas
    // la chaîne exacte caractère par caractère.
    const formatted = formatPrice(12.99, 'EUR');

    expect(formatted).toContain('12,99');
    expect(formatted).toContain('€');
  });

  it('formate une autre devise valide', () => {
    expect(formatPrice(10, 'USD')).toMatch(/10,00/);
  });

  it('retombe sur l’euro plutôt que de lever sur une devise inconnue', () => {
    // Le code devise vient de la base, donc du scrapper : une valeur
    // fantaisiste ne doit pas faire planter le rendu serveur de la page.
    expect(() => formatPrice(10, 'PAS-UNE-DEVISE')).not.toThrow();
    expect(formatPrice(10, 'PAS-UNE-DEVISE')).toContain('€');
  });

  it('formate zéro et les négatifs', () => {
    expect(formatPrice(0, 'EUR')).toContain('0,00');
    expect(formatPrice(-3.5, 'EUR')).toContain('-3,50');
  });
});

describe('timeAgo', () => {
  const now = new Date('2026-08-08T12:00:00.000Z');

  function ago(ms: number): string {
    vi.setSystemTime(now);
    return timeAgo(new Date(now.getTime() - ms).toISOString());
  }

  afterEach(() => vi.useRealTimers());

  it.each([
    ['moins d’une minute', 30_000, "à l'instant"],
    ['une minute', 60_000, 'il y a 1min'],
    ['59 minutes', 59 * 60_000, 'il y a 59min'],
    ['une heure', 60 * 60_000, 'il y a 1h'],
    ['23 heures', 23 * 3_600_000, 'il y a 23h'],
    ['un jour', 24 * 3_600_000, 'il y a 1j'],
    ['trois jours', 3 * 24 * 3_600_000, 'il y a 3j'],
  ])('%s', (_label, ms, expected) => {
    vi.useFakeTimers();
    expect(ago(ms)).toBe(expected);
  });

  it('traite une date future comme « à l’instant »', () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);

    expect(timeAgo(new Date(now.getTime() + 60_000).toISOString())).toBe("à l'instant");
  });
});

describe('dates', () => {
  it('affiche la date de Paris, pas celle du serveur réglé en UTC', () => {
    // 23 h 30 UTC le 5 novembre : 0 h 30 le 6 à Paris (UTC+1 en hiver).
    expect(formatDate('2026-11-05T23:30:00.000Z')).toBe('06/11/2026');
    expect(formatDayMonth('2026-11-05T23:30:00.000Z')).toBe('06/11');
  });

  it('affiche l’heure de Paris, été comme hiver', () => {
    expect(formatDateTime('2026-11-05T12:30:05.000Z')).toBe('05/11/2026 13:30:05');
    expect(formatDateTime('2026-07-05T12:30:05.000Z')).toBe('05/07/2026 14:30:05');
  });

  it('garde le jour d’un relevé daté de minuit UTC', () => {
    expect(formatDate('2026-08-08T00:00:00.000Z')).toBe('08/08/2026');
  });
});

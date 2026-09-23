import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatPrice, shortDigest, timeAgo } from './format';

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

describe('shortDigest', () => {
  it('garde les 12 premiers caractères hexadécimaux', () => {
    expect(shortDigest(`sha256:${'3f1c9a2b7e04'}${'0'.repeat(52)}`)).toBe('3f1c9a2b7e04');
  });

  it('affiche un tiret pour un digest inconnu', () => {
    expect(shortDigest(null)).toBe('—');
  });
});

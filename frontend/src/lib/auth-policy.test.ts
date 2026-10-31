import { describe, expect, it } from 'vitest';
import { isEmailAllowed, isProfileAllowed, parseAllowedEmails, safeCallbackPath } from './auth-policy';

describe('parseAllowedEmails', () => {
  it('découpe, normalise et ignore les entrées vides', () => {
    expect([...parseAllowedEmails(' Moi@Gmail.com, ,toi@gmail.com ')]).toEqual([
      'moi@gmail.com',
      'toi@gmail.com',
    ]);
  });

  it('donne une liste vide sans variable', () => {
    expect(parseAllowedEmails(undefined).size).toBe(0);
  });
});

describe('isEmailAllowed', () => {
  const allowed = parseAllowedEmails('moi@gmail.com');

  it('accepte une adresse de la liste, quelle que soit sa casse', () => {
    expect(isEmailAllowed('MOI@gmail.com', allowed)).toBe(true);
  });

  it('refuse une adresse absente de la liste', () => {
    expect(isEmailAllowed('intrus@gmail.com', allowed)).toBe(false);
  });

  it('accepte toute adresse quand la liste est vide', () => {
    expect(isEmailAllowed('quiconque@gmail.com', new Set())).toBe(true);
  });

  it('refuse l’absence d’adresse, même liste vide', () => {
    expect(isEmailAllowed(undefined, new Set())).toBe(false);
    expect(isEmailAllowed(null, new Set())).toBe(false);
  });
});

describe('isProfileAllowed', () => {
  const allowed = parseAllowedEmails('moi@gmail.com');

  it('accepte une adresse vérifiée et autorisée', () => {
    expect(isProfileAllowed({ email: 'moi@gmail.com', email_verified: true }, allowed)).toBe(true);
  });

  it('refuse une adresse non vérifiée par Google : elle deviendrait un identifiant usurpable', () => {
    expect(isProfileAllowed({ email: 'moi@gmail.com', email_verified: false }, allowed)).toBe(false);
    expect(isProfileAllowed({ email: 'moi@gmail.com' }, allowed)).toBe(false);
  });

  it('refuse un profil absent', () => {
    expect(isProfileAllowed(undefined, new Set())).toBe(false);
  });
});

describe('safeCallbackPath', () => {
  it.each([
    ['/keywords', '/keywords'],
    ['/product/abc?x=1', '/product/abc?x=1'],
    [['/fuel', '/autre'], '/fuel'],
    // Forme réelle envoyée par le middleware d'Auth.js : l'URL complète.
    ['https://prix.example.fr/keyword/lessive?page=2', '/keyword/lessive?page=2'],
    // Un hôte forgé est simplement ignoré : on reste sur ce site.
    ['https://pirate.example/keywords', '/keywords'],
  ])('garde le chemin local %p', (raw, expected) => {
    expect(safeCallbackPath(raw)).toBe(expected);
  });

  it.each([
    [undefined],
    [''],
    ['//pirate.example'],
    ['/\\pirate.example'],
    ['javascript:alert(1)'],
    ['/login?callbackUrl=/login'],
  ])(
    'ramène %p à l’accueil',
    (raw) => {
      expect(safeCallbackPath(raw)).toBe('/');
    },
  );
});

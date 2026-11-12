import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatParisDateTime } from './format-time.js';

describe('formatParisDateTime', () => {
  // Le backend parle UTC, l'utilisateur vit à Paris : +1 h l'hiver, +2 h l'été.
  it("convertit l'UTC en heure de Paris, heure d'hiver comme d'été", () => {
    assert.equal(formatParisDateTime('2026-11-08T13:30:00.000Z'), '2026-11-08 14:30');
    assert.equal(formatParisDateTime('2026-07-01T13:30:00.000Z'), '2026-07-01 15:30');
  });

  it('change de jour quand Paris a passé minuit', () => {
    assert.equal(formatParisDateTime('2026-11-08T23:30:00.000Z'), '2026-11-09 00:30');
  });

  it('ne plante pas sur une date absente ou illisible', () => {
    assert.equal(formatParisDateTime(null), 'date inconnue');
    assert.equal(formatParisDateTime('pas une date'), 'date inconnue');
  });
});

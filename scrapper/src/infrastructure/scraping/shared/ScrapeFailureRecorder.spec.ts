import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ScrapeFailure } from '../../../domain/scrapeFailure/ScrapeFailure.js';
import {
  MAX_SNAPSHOTS_PER_REASON,
  ScrapeFailureRecorder,
  type FailureLogger,
  type FailureReport,
} from './ScrapeFailureRecorder.js';

const NOW = new Date('2026-11-11T03:00:00Z');

function setup(record: (failure: ScrapeFailure) => Promise<void> = async () => {}) {
  const saved: ScrapeFailure[] = [];
  const logs: { level: string; message: string }[] = [];
  const logger: FailureLogger = {
    info: (message) => logs.push({ level: 'info', message }),
    warning: (message) => logs.push({ level: 'warning', message }),
    error: (message) => logs.push({ level: 'error', message }),
  };
  const recorder = new ScrapeFailureRecorder(
    {
      record: async (failure) => {
        await record(failure);
        saved.push(failure);
      },
    },
    logger,
    'amazon',
    () => NOW,
  );
  return { recorder, saved, logs };
}

function report(overrides: Partial<FailureReport> = {}): FailureReport {
  return {
    url: 'https://www.amazon.fr/dp/B0ABCDEFGH/',
    keyword: 'lessive',
    pageKind: 'product',
    attempt: 1,
    outcome: 'skipped',
    reason: 'layout_changed',
    detail: 'titre introuvable',
    evidence: {
      finalUrl: 'https://www.amazon.fr/dp/B0ABCDEFGH/',
      httpStatus: 200,
      documentTitle: 'Amazon.fr : Lessive',
      bodyText: 'x'.repeat(5000),
      htmlLength: 12,
      markers: { captchaForm: false, productLayout: true, searchLayout: false, searchResults: 0 },
    },
    html: '<html></html>',
    keepSnapshot: true,
    ...overrides,
  };
}

describe('ScrapeFailureRecorder', () => {
  it('persiste un échec complet, extrait de texte tronqué', async () => {
    const { recorder, saved } = setup();
    await recorder.record(report());
    assert.equal(saved.length, 1);
    const [failure] = saved;
    assert.equal(failure.shop, 'amazon');
    assert.equal(failure.httpStatus, 200);
    assert.equal(failure.pageTitle, 'Amazon.fr : Lessive');
    assert.equal(failure.textExcerpt?.length, 1000);
    assert.equal(failure.htmlSnapshot, '<html></html>');
    assert.deepEqual(failure.occurredAt, NOW);
  });

  it("ne garde jamais le HTML d'une tentative qui sera réessayée", async () => {
    const { recorder, saved } = setup();
    await recorder.record(report({ reason: 'unknown', outcome: 'retried' }));
    await recorder.record(report({ reason: 'unknown', outcome: 'gave_up' }));
    assert.deepEqual(saved.map((f) => f.htmlSnapshot), [null, '<html></html>']);
  });

  it('plafonne le nombre de pages HTML conservées par cause', async () => {
    const { recorder, saved } = setup();
    for (let i = 0; i < MAX_SNAPSHOTS_PER_REASON + 3; i++) await recorder.record(report());
    await recorder.record(report({ reason: 'unknown', outcome: 'gave_up' }));
    const kept = saved.filter((f) => f.htmlSnapshot !== null);
    assert.equal(kept.filter((f) => f.reason === 'layout_changed').length, MAX_SNAPSHOTS_PER_REASON);
    assert.equal(kept.filter((f) => f.reason === 'unknown').length, 1);
  });

  it('enregistre un échec de requête sans relevé de page', async () => {
    const { recorder, saved } = setup();
    await recorder.record({
      url: 'https://www.amazon.fr/s?k=lessive',
      keyword: 'lessive',
      pageKind: 'search',
      attempt: 4,
      outcome: 'gave_up',
      reason: 'request_error',
      detail: 'Navigation timed out after 60 seconds.',
      error: 'TimeoutError: Navigation timed out after 60 seconds.\n    at …',
    });
    const [failure] = saved;
    assert.equal(failure.finalUrl, null);
    assert.equal(failure.markers, null);
    assert.equal(failure.htmlSnapshot, null);
    assert.match(failure.error ?? '', /TimeoutError/);
  });

  it("ne fait jamais échouer le scrape quand la base refuse l'écriture", async () => {
    const { recorder, logs } = setup(async () => {
      throw new Error('connection refused');
    });
    await recorder.record(report());
    assert.ok(logs.some((l) => l.level === 'error' && /non enregistré/.test(l.message)));
    assert.equal(recorder.summary().length, 1);
  });

  it('journalise une refonte et un abandon en erreur, une fiche supprimée en info', async () => {
    const { recorder, logs } = setup();
    await recorder.record(report());
    await recorder.record(report({ reason: 'captcha', outcome: 'gave_up', keepSnapshot: false }));
    await recorder.record(report({ reason: 'captcha', outcome: 'retried', keepSnapshot: false }));
    await recorder.record(report({ reason: 'not_found', outcome: 'marked_unavailable', keepSnapshot: false }));
    assert.deepEqual(logs.map((l) => l.level), ['error', 'error', 'warning', 'info']);
  });

  it('dresse le bilan par cause, la plus fréquente en tête', async () => {
    const { recorder, logs } = setup();
    await recorder.record(report({ reason: 'captcha', outcome: 'retried' }));
    await recorder.record(report({ reason: 'captcha', outcome: 'retried' }));
    await recorder.record(report({ reason: 'captcha', outcome: 'gave_up' }));
    await recorder.record(report());
    assert.deepEqual(recorder.summary(), [
      'captcha : 3 (réessayée 2, abandonnée 1)',
      'layout_changed : 1 (ignorée 1) — sélecteurs probablement obsolètes, voir scrape_failures.html',
    ]);
    logs.length = 0;
    recorder.logSummary();
    assert.equal(logs[0].level, 'warning');
    assert.match(logs[0].message, /Bilan des échecs de pages \(4,/);
  });

  it('annonce un passage sans échec', () => {
    const { recorder, logs } = setup();
    recorder.logSummary();
    assert.deepEqual(logs, [{ level: 'info', message: 'Bilan des échecs de pages : aucun échec.' }]);
  });
});

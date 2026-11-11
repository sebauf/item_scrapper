import type { PlaywrightCrawlingContext } from 'crawlee';
import type { PageKind } from '../../../domain/scrapeFailure/ScrapeFailure.js';
import type { ScrapeFailureRecorder } from '../shared/ScrapeFailureRecorder.js';
import {
  diagnosePage,
  PageDiagnosisError,
  type PageDiagnosis,
  type PageEvidence,
} from './AmazonPageDiagnosis.js';
import { collectPageEvidence } from './AmazonPageEvidence.js';

export interface UnreadablePage {
  diagnosis: PageDiagnosis;
  evidence: PageEvidence;
  html: string | null;
}

/**
 * Diagnostique une page que le handler n'a pas su lire.
 *
 * Si une nouvelle tentative a une chance d'aboutir (blocage, page vide,
 * cause inconnue), **lève** une `PageDiagnosisError` : Crawlee remet alors la
 * requête en file — après avoir changé de session si Amazon l'a repérée — et
 * l'échec est enregistré par `errorHandler` / `failedRequestHandler`
 * (cf. AmazonCrawler). Avant, la page était simplement abandonnée : un
 * captcha passager coûtait le relevé du jour.
 *
 * Sinon, rend le diagnostic au handler, qui décide quoi faire de la page et
 * l'enregistre.
 */
export async function diagnoseOrRetry(
  { page, response, session }: PlaywrightCrawlingContext,
  kind: PageKind,
): Promise<UnreadablePage> {
  const { evidence, html } = await collectPageEvidence(page, response);
  const diagnosis = diagnosePage(evidence, kind);
  if (diagnosis.retryable) {
    if (diagnosis.rotateSession) session?.retire();
    throw new PageDiagnosisError(diagnosis, evidence, html);
  }
  return { diagnosis, evidence, html };
}

/** Enregistre un échec qui n'est pas réessayé, diagnostiqué par `diagnoseOrRetry`. */
export async function recordUnreadablePage(
  failures: ScrapeFailureRecorder,
  { request }: PlaywrightCrawlingContext,
  kind: PageKind,
  { diagnosis, evidence, html }: UnreadablePage,
  outcome: 'skipped' | 'marked_unavailable',
): Promise<void> {
  const { keyword } = request.userData as { keyword?: string };
  await failures.record({
    url: request.url,
    keyword: keyword ?? null,
    pageKind: kind,
    attempt: request.retryCount + 1,
    outcome,
    reason: diagnosis.reason,
    detail: diagnosis.detail,
    evidence,
    html,
    keepSnapshot: diagnosis.keepSnapshot,
  });
}

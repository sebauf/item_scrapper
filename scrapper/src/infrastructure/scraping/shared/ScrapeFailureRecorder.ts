import type { IScrapeFailureRepository } from '../../../domain/scrapeFailure/IScrapeFailureRepository.js';
import type {
  PageKind,
  PageMarkers,
  ScrapeFailure,
  ScrapeFailureOutcome,
  ScrapeFailureReason,
} from '../../../domain/scrapeFailure/ScrapeFailure.js';

/** Sous-ensemble du logger Crawlee utilisé ici (injectable dans les tests). */
export interface FailureLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warning(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export interface FailureEvidence {
  finalUrl: string;
  httpStatus: number | null;
  documentTitle: string;
  bodyText: string;
  htmlLength: number;
  markers: PageMarkers;
}

export interface FailureReport {
  url: string;
  keyword: string | null;
  pageKind: PageKind;
  attempt: number;
  outcome: ScrapeFailureOutcome;
  reason: ScrapeFailureReason;
  detail: string;
  evidence?: FailureEvidence | null;
  html?: string | null;
  /** La cause est incertaine : le HTML mérite d'être conservé. */
  keepSnapshot?: boolean;
  error?: string | null;
}

/**
 * Plafond de pages HTML conservées par cause et par passage. Une refonte
 * d'Amazon rendrait illisibles des centaines de fiches d'un coup : quelques
 * exemplaires suffisent à l'analyser, des centaines rempliraient la base.
 */
export const MAX_SNAPSHOTS_PER_REASON = 5;
/** Un HTML plus gros n'est pas conservé (une fiche Amazon pèse ~1 à 2 Mo). */
export const MAX_SNAPSHOT_LENGTH = 4_000_000;
const TEXT_EXCERPT_LENGTH = 1000;
const ERROR_MAX_LENGTH = 2000;

const OUTCOME_LABELS: Record<ScrapeFailureOutcome, string> = {
  retried: 'réessayée',
  gave_up: 'abandonnée',
  skipped: 'ignorée',
  marked_unavailable: 'marquée indisponible',
};

/**
 * Point unique par lequel passe chaque échec de page : il le journalise (une
 * ligne lisible dans les logs Airflow), le persiste dans `scrape_failures`
 * et le compte pour le bilan de fin de passage.
 *
 * L'enregistrement ne fait jamais échouer le scrape : une base indisponible
 * coûte la trace de l'échec, pas les pages suivantes.
 */
export class ScrapeFailureRecorder {
  private readonly counts = new Map<ScrapeFailureReason, Map<ScrapeFailureOutcome, number>>();
  private readonly snapshots = new Map<ScrapeFailureReason, number>();

  constructor(
    private readonly repository: IScrapeFailureRepository,
    private readonly logger: FailureLogger,
    private readonly shop: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async record(report: FailureReport): Promise<void> {
    this.count(report.reason, report.outcome);
    const failure = this.toFailure(report);
    this.log(failure);
    try {
      await this.repository.record(failure);
    } catch (err) {
      this.logger.error("Échec de page non enregistré en base", {
        url: report.url,
        reason: report.reason,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Bilan du passage, une ligne par cause, la plus fréquente d'abord. */
  summary(): string[] {
    const rows = [...this.counts.entries()]
      .map(([reason, byOutcome]) => {
        const total = [...byOutcome.values()].reduce((sum, n) => sum + n, 0);
        const detail = [...byOutcome.entries()]
          .map(([outcome, n]) => `${OUTCOME_LABELS[outcome]} ${n}`)
          .join(', ');
        return { reason, total, line: `${reason} : ${total} (${detail})` };
      })
      .sort((a, b) => b.total - a.total || a.reason.localeCompare(b.reason));
    return rows.map((row) =>
      row.reason === 'layout_changed'
        ? `${row.line} — sélecteurs probablement obsolètes, voir scrape_failures.html`
        : row.line,
    );
  }

  logSummary(): void {
    const lines = this.summary();
    if (lines.length === 0) {
      this.logger.info('Bilan des échecs de pages : aucun échec.');
      return;
    }
    const total = [...this.counts.values()]
      .flatMap((byOutcome) => [...byOutcome.values()])
      .reduce((sum, n) => sum + n, 0);
    const message = `Bilan des échecs de pages (${total}, détail dans la collection scrape_failures) :\n  ${lines.join('\n  ')}`;
    if (this.counts.has('layout_changed') || this.hasOutcome('gave_up')) {
      this.logger.warning(message);
    } else {
      this.logger.info(message);
    }
  }

  private hasOutcome(outcome: ScrapeFailureOutcome): boolean {
    return [...this.counts.values()].some((byOutcome) => (byOutcome.get(outcome) ?? 0) > 0);
  }

  private count(reason: ScrapeFailureReason, outcome: ScrapeFailureOutcome): void {
    const byOutcome = this.counts.get(reason) ?? new Map<ScrapeFailureOutcome, number>();
    byOutcome.set(outcome, (byOutcome.get(outcome) ?? 0) + 1);
    this.counts.set(reason, byOutcome);
  }

  /**
   * Le HTML n'est gardé que pour une page abandonnée : une tentative qui
   * sera réessayée a des chances d'aboutir, et la garder à chaque essai
   * multiplierait le volume par le nombre de tentatives.
   */
  private takeSnapshot(report: FailureReport): string | null {
    if (!report.keepSnapshot || report.outcome === 'retried' || !report.html) return null;
    if (report.html.length > MAX_SNAPSHOT_LENGTH) return null;
    const taken = this.snapshots.get(report.reason) ?? 0;
    if (taken >= MAX_SNAPSHOTS_PER_REASON) return null;
    this.snapshots.set(report.reason, taken + 1);
    return report.html;
  }

  private toFailure(report: FailureReport): ScrapeFailure {
    const evidence = report.evidence ?? null;
    return {
      url: report.url,
      finalUrl: evidence?.finalUrl ?? null,
      keyword: report.keyword,
      shop: this.shop,
      pageKind: report.pageKind,
      reason: report.reason,
      outcome: report.outcome,
      attempt: report.attempt,
      detail: report.detail,
      httpStatus: evidence?.httpStatus ?? null,
      pageTitle: evidence ? evidence.documentTitle || null : null,
      textExcerpt: evidence ? evidence.bodyText.slice(0, TEXT_EXCERPT_LENGTH) || null : null,
      htmlLength: evidence?.htmlLength ?? null,
      markers: evidence?.markers ?? null,
      error: report.error ? report.error.slice(0, ERROR_MAX_LENGTH) : null,
      htmlSnapshot: this.takeSnapshot(report),
      occurredAt: this.now(),
    };
  }

  private log(failure: ScrapeFailure): void {
    const message = `Échec de page [${failure.reason}] ${OUTCOME_LABELS[failure.outcome]} (tentative ${failure.attempt}) : ${failure.detail}`;
    const data = {
      url: failure.url,
      finalUrl: failure.finalUrl ?? undefined,
      httpStatus: failure.httpStatus ?? undefined,
      pageTitle: failure.pageTitle ?? undefined,
      keyword: failure.keyword ?? undefined,
      error: failure.error ?? undefined,
    };
    if (failure.reason === 'layout_changed' || failure.outcome === 'gave_up') {
      this.logger.error(message, data);
    } else if (failure.reason === 'not_found' || failure.reason === 'no_results') {
      this.logger.info(message, data);
    } else {
      this.logger.warning(message, data);
    }
  }
}

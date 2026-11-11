import type {
  PageKind,
  PageMarkers,
  ScrapeFailureReason,
} from '../../../domain/scrapeFailure/ScrapeFailure.js';

/**
 * Pourquoi une page Amazon n'a pas pu être lue — règles pures, sans
 * navigateur, appelées seulement quand la lecture a déjà échoué (fiche sans
 * titre, recherche sans résultat).
 *
 * L'ordre des règles est celui de la certitude : l'URL et le formulaire de
 * captcha ne mentent pas, le statut HTTP presque jamais, le texte de la page
 * en dernier (il dépend de la langue et des refontes).
 */

/** Ce que le navigateur a vu de la page au moment de l'échec. */
export interface PageEvidence {
  finalUrl: string;
  httpStatus: number | null;
  documentTitle: string;
  /** Texte visible, espaces normalisés — entier : les motifs y sont cherchés partout. */
  bodyText: string;
  htmlLength: number;
  markers: PageMarkers;
}

export interface PageDiagnosis {
  reason: ScrapeFailureReason;
  /** Une nouvelle tentative a une chance d'aboutir. */
  retryable: boolean;
  /** Amazon a reconnu la session : en changer avant de réessayer. */
  rotateSession: boolean;
  /** Cause incertaine : conserver le HTML pour l'analyser. */
  keepSnapshot: boolean;
  /** Explication lisible, reprise dans les logs et en base. */
  detail: string;
}

const SIGN_IN_PATH_FRAGMENTS = ['/ap/signin', '/ap/cvf'];
const CAPTCHA_PATH_FRAGMENTS = ['/errors/validateCaptcha'];

/** Sous ce volume, la page n'a manifestement pas été rendue. */
const EMPTY_HTML_MAX_LENGTH = 2000;
const EMPTY_TEXT_MAX_LENGTH = 30;

const CAPTCHA_TEXT =
  /pas un robot|not a robot|caract[eè]res que vous voyez|characters you see|continuer (?:vos|les) achats|continue shopping/i;
const NOT_FOUND_TEXT =
  /n'est pas une page active|page introuvable|cherchez-vous quelque chose|looking for something\?|page you requested (?:was|could) not (?:be )?found/i;
const RATE_LIMITED_TEXT =
  /une erreur s'est produite|un probl[eè]me est survenu|something went wrong|toutes nos excuses|service unavailable/i;
const NO_RESULTS_TEXT = /aucun r[ée]sultat pour|no results for|did not match any products/i;

export function isSignInUrl(url: string): boolean {
  return SIGN_IN_PATH_FRAGMENTS.some((fragment) => url.includes(fragment));
}

export function isCaptchaUrl(url: string): boolean {
  return CAPTCHA_PATH_FRAGMENTS.some((fragment) => url.includes(fragment));
}

/** Page de blocage d'Amazon (captcha ou connexion forcée), d'après son URL. */
export function isBlockUrl(url: string): boolean {
  return isSignInUrl(url) || isCaptchaUrl(url);
}

function diagnosis(
  reason: ScrapeFailureReason,
  detail: string,
  options: Partial<Pick<PageDiagnosis, 'retryable' | 'rotateSession' | 'keepSnapshot'>> = {},
): PageDiagnosis {
  return {
    reason,
    detail,
    retryable: options.retryable ?? false,
    rotateSession: options.rotateSession ?? false,
    keepSnapshot: options.keepSnapshot ?? false,
  };
}

const BLOCKED = { retryable: true, rotateSession: true } as const;

export function diagnosePage(evidence: PageEvidence, kind: PageKind): PageDiagnosis {
  const { finalUrl, httpStatus, bodyText, htmlLength, markers } = evidence;

  // 1. L'URL : Amazon redirige vers ses pages de blocage.
  if (isSignInUrl(finalUrl)) {
    return diagnosis('sign_in', `Redirigé vers la connexion (${finalUrl})`, BLOCKED);
  }
  if (isCaptchaUrl(finalUrl) || markers.captchaForm) {
    return diagnosis('captcha', 'Page de vérification anti-robot (formulaire de captcha)', BLOCKED);
  }

  // 2. Le statut HTTP.
  if (httpStatus === 404 || httpStatus === 410) {
    return diagnosis('not_found', `HTTP ${httpStatus} : la fiche n'existe plus`);
  }
  if (httpStatus === 429 || httpStatus === 503) {
    return diagnosis('rate_limited', `HTTP ${httpStatus} : Amazon refuse de servir la page`, BLOCKED);
  }
  if (httpStatus !== null && httpStatus >= 400) {
    const serverSide = httpStatus >= 500;
    return diagnosis('http_error', `HTTP ${httpStatus}`, { retryable: serverSide });
  }

  // 3. Une page vide ne prouve rien, sinon que le rendu n'a pas abouti.
  if (htmlLength < EMPTY_HTML_MAX_LENGTH && bodyText.length < EMPTY_TEXT_MAX_LENGTH) {
    return diagnosis('empty_page', `Page vide (${htmlLength} caractères de HTML)`, {
      retryable: true,
    });
  }

  // 4. La page a le squelette attendu mais nos sélecteurs n'y trouvent rien :
  // c'est le code qu'il faut réparer, une nouvelle tentative lirait la même
  // page. Testé avant le texte : une vraie fiche peut contenir « continuer
  // vos achats » ou « une erreur s'est produite » quelque part.
  if (kind === 'search' && NO_RESULTS_TEXT.test(bodyText)) {
    return diagnosis('no_results', 'La recherche ne renvoie aucun résultat');
  }
  if (kind === 'product' && markers.productLayout) {
    return diagnosis(
      'layout_changed',
      'Fiche produit reconnue mais titre introuvable : sélecteur #productTitle probablement obsolète',
      { keepSnapshot: true },
    );
  }
  if (kind === 'search' && markers.searchLayout) {
    return diagnosis(
      'layout_changed',
      'Page de résultats reconnue mais aucun résultat lisible : sélecteurs de recherche probablement obsolètes',
      { keepSnapshot: true },
    );
  }

  // 5. Le texte, en dernier recours.
  if (CAPTCHA_TEXT.test(bodyText)) {
    return diagnosis('captcha', 'Page de vérification anti-robot (texte)', BLOCKED);
  }
  if (NOT_FOUND_TEXT.test(bodyText)) {
    return diagnosis('not_found', "Page « introuvable » : la fiche n'existe plus");
  }
  if (RATE_LIMITED_TEXT.test(bodyText)) {
    return diagnosis('rate_limited', "Page d'erreur d'Amazon (« une erreur s'est produite »)", BLOCKED);
  }

  return diagnosis(
    'unknown',
    `Page non reconnue (titre « ${evidence.documentTitle || '—'} »)`,
    { retryable: true, keepSnapshot: true },
  );
}

/**
 * Erreur levée par un handler pour faire réessayer une page diagnostiquée :
 * elle transporte le diagnostic jusqu'à `errorHandler` / `failedRequestHandler`,
 * qui l'enregistrent sans avoir à relire une page peut-être déjà fermée.
 */
export class PageDiagnosisError extends Error {
  constructor(
    readonly diagnosis: PageDiagnosis,
    readonly evidence: PageEvidence,
    readonly html: string | null,
  ) {
    super(`${diagnosis.reason} — ${diagnosis.detail}`);
    this.name = 'PageDiagnosisError';
  }
}

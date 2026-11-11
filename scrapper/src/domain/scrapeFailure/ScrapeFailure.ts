/**
 * Une page que le scrapper n'a pas su lire, et pourquoi.
 *
 * Avant ce type, une fiche sans titre était abandonnée avec un simple
 * avertissement dans la console : impossible de distinguer après coup un
 * captcha (Amazon nous bloque — il faut ralentir), une fiche supprimée (le
 * produit est mort — il faut l'oublier) et une refonte de la page (nos
 * sélecteurs sont obsolètes — il faut réparer le code). Trois causes, trois
 * remèdes opposés : chaque échec est désormais classé et conservé.
 */

/** Type de page en échec : fiche produit ou page de résultats de recherche. */
export type PageKind = 'product' | 'search';

export type ScrapeFailureReason =
  /** Page de vérification anti-robot (captcha, « continuer vos achats »). */
  | 'captcha'
  /** Redirection vers la connexion (`/ap/signin`, `/ap/cvf`). */
  | 'sign_in'
  /** Amazon refuse de servir : HTTP 429 / 503, page « une erreur s'est produite ». */
  | 'rate_limited'
  /** Fiche supprimée : HTTP 404 / 410 ou page « introuvable ». */
  | 'not_found'
  /** Autre statut HTTP d'erreur. */
  | 'http_error'
  /** Page vide : rendu interrompu, réponse tronquée. */
  | 'empty_page'
  /** La page est bien une fiche (ou une recherche) mais nos sélecteurs n'y trouvent rien. */
  | 'layout_changed'
  /** Recherche sans aucun résultat (le mot-clé ne correspond à rien). */
  | 'no_results'
  /** Aucune des causes connues : la page est conservée pour analyse. */
  | 'unknown'
  /** La requête elle-même a échoué (délai de navigation, navigateur planté…). */
  | 'request_error';

/**
 * Ce que le scrapper a fait de l'échec.
 *
 * - `retried` : la requête est remise en file (nouvelle session si blocage) ;
 * - `gave_up` : plus aucune tentative, la page est perdue pour ce passage ;
 * - `skipped` : inutile de réessayer (refonte, recherche vide) ;
 * - `marked_unavailable` : fiche supprimée, marquée indisponible comme une
 *   fiche redirigée.
 */
export type ScrapeFailureOutcome = 'retried' | 'gave_up' | 'skipped' | 'marked_unavailable';

/** Présence d'éléments caractéristiques, relevée dans la page au moment de l'échec. */
export interface PageMarkers {
  /** Formulaire de captcha (`/errors/validateCaptcha`, `#captchacharacters`). */
  captchaForm: boolean;
  /** Squelette d'une fiche produit (`#dp`, `input#ASIN`, bouton panier…). */
  productLayout: boolean;
  /** Squelette d'une page de résultats (`.s-main-slot`, `#search`). */
  searchLayout: boolean;
  /** Nombre de résultats de recherche lisibles. */
  searchResults: number;
}

export interface ScrapeFailure {
  /** URL demandée. */
  url: string;
  /** URL réellement affichée (après redirections), `null` si inconnue. */
  finalUrl: string | null;
  keyword: string | null;
  shop: string;
  pageKind: PageKind;
  reason: ScrapeFailureReason;
  outcome: ScrapeFailureOutcome;
  /** Numéro de la tentative (1 = premier essai). */
  attempt: number;
  /** Explication lisible de la classification. */
  detail: string;
  httpStatus: number | null;
  /** `document.title` de la page reçue. */
  pageTitle: string | null;
  /** Début du texte visible de la page, espaces normalisés. */
  textExcerpt: string | null;
  htmlLength: number | null;
  markers: PageMarkers | null;
  /** Message d'erreur, pour les échecs de requête. */
  error: string | null;
  /**
   * HTML complet de la page, seulement quand la cause est incertaine
   * (`unknown`, `layout_changed`) et que la page est abandonnée : c'est la
   * seule façon de voir ce qu'Amazon a vraiment servi.
   */
  htmlSnapshot: string | null;
  occurredAt: Date;
}

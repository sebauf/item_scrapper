/**
 * Dates pour le modèle, en **heure de Paris** : le backend renvoie de l'UTC,
 * mais « rupture probable avant 14:30 » ou « relevé le 08/11 » n'ont de sens
 * pour l'utilisateur que dans son fuseau. Format ISO-like, compact et sans
 * ambiguïté pour un modèle : `2026-11-08 14:30`.
 */

const TIME_ZONE = 'Europe/Paris';

const PARIS_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** ISO 8601 (UTC) → `2026-11-08 14:30`, heure de Paris. */
export function formatParisDateTime(iso: string | null): string {
  if (iso === null) return 'date inconnue';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'date inconnue';
  const parts = Object.fromEntries(
    PARIS_FORMAT.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

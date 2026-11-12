/**
 * Fuseau des dates affichées. Explicite : les pages sont rendues côté serveur,
 * dans un Pod réglé en UTC — sans lui, un relevé de 0 h 30 à Paris
 * s'afficherait à la date de la veille, et un composant client rendu sur le
 * serveur puis dans le navigateur afficherait deux dates différentes.
 */
export const DISPLAY_TIME_ZONE = 'Europe/Paris';

const date = new Intl.DateTimeFormat('fr-FR', { timeZone: DISPLAY_TIME_ZONE });
const dayMonth = new Intl.DateTimeFormat('fr-FR', {
  timeZone: DISPLAY_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
});
const dateTime = new Intl.DateTimeFormat('fr-FR', {
  timeZone: DISPLAY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** « 05/11/2026 », date de Paris. */
export function formatDate(iso: string): string {
  return date.format(new Date(iso));
}

/** « 05/11 », date de Paris — axe du graphique de prix. */
export function formatDayMonth(iso: string): string {
  return dayMonth.format(new Date(iso));
}

/** « 05/11/2026 12:30:05 », heure de Paris. */
export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

export function formatPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(amount);
  } catch {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
  }
}

export function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `il y a ${days}j`;
  if (hours > 0) return `il y a ${hours}h`;
  if (minutes > 0) return `il y a ${minutes}min`;
  return "à l'instant";
}

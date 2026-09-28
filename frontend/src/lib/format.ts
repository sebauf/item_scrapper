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

/**
 * Nombre de jours calendaires entre le relevé et maintenant, à l'heure de Paris.
 *
 * On compte des changements de date, pas des tranches de 24 h : un article relevé
 * hier à 23 h et affiché ce matin à 8 h a « 1 jour », pas « 0 ». Le fuseau est
 * fixé pour que le rendu serveur (conteneur en UTC) donne le même jour que
 * l'horloge de l'utilisateur, le scrape tournant de nuit, près de minuit UTC.
 *
 * `null` pour une date illisible (le backend renvoie `''` faute de relevé) ;
 * une date future — horloges désynchronisées — compte pour aujourd'hui.
 */
export function daysSince(iso: string, now: Date = new Date()): number | null {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const diff = (parisDay(now) - parisDay(then)) / 86_400_000;
  return Math.max(0, diff);
}

const parisDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Minuit UTC du jour calendaire parisien de `date` — un entier de jours × 86 400 000. */
function parisDay(date: Date): number {
  return Date.parse(`${parisDate.format(date)}T00:00:00Z`);
}

import type {
  BrandCount,
  FavoriteFuel,
  FuelCode,
  FuelPrice,
  FuelStation,
  RestockChanceLevel,
  RestockOutlook,
  ShortageOutlook,
  ShortageRiskLevel,
} from './api';

/**
 * Logique d'affichage de la carte des carburants — tout ce qui se teste sans
 * navigateur ni carte.
 *
 * Le backend juge déjà la disponibilité et la fraîcheur (`available`,
 * `isStale`) ; ce module ne décide que de la présentation : libellés, URL,
 * format des prix, couleur des repères.
 */

/** Ordre d'affichage : du plus vendu au plus rare. */
export const FUEL_CODES: readonly FuelCode[] = ['gazole', 'e10', 'sp98', 'sp95', 'e85', 'gplc'];

export const FUEL_LABELS: Record<FuelCode, string> = {
  gazole: 'Gazole',
  e10: 'SP95-E10',
  sp98: 'SP98',
  sp95: 'SP95',
  e85: 'E85',
  gplc: 'GPLc',
};

export const RADIUS_OPTIONS = [5, 10, 20, 30] as const;
export const DEFAULT_RADIUS_KM = 10;
export const DEFAULT_FUEL: FuelCode = 'gazole';
/**
 * Enseigne affichée à la première visite. Libellé exact du pipeline
 * (`BRAND_ALIASES` y ramène « Total », « Total Access »…) : le backend compare
 * à l'identique.
 */
export const DEFAULT_BRAND = 'TotalEnergies';
/** Même borne que le backend (`MAX_BRAND_LENGTH`) : au-delà, il refuserait. */
const MAX_BRAND_LENGTH = 60;

/** Centre affiché tant que l'utilisateur n'a pas donné sa position. */
export const DEFAULT_CENTER = { lat: 48.8566, lng: 2.3522, label: 'Paris' } as const;

export type FuelSort = 'price' | 'distance';

export interface FuelSearchParams {
  lat: number;
  lng: number;
  radiusKm: number;
  /** null = tous les carburants. */
  fuel: FuelCode | null;
  sort: FuelSort;
  /** null = toutes les enseignes. */
  brand: string | null;
  /** Faux tant que la position est celle par défaut, pas celle de l'utilisateur. */
  located: boolean;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isFuelCode(value: string): value is FuelCode {
  return (FUEL_CODES as readonly string[]).includes(value);
}

/**
 * Lecture indulgente de l'URL : une valeur aberrante retombe sur le défaut
 * (cf. search-params.ts). Le backend, lui, refuserait — on ne lui transmet
 * donc que ce qui sort d'ici.
 *
 * `fuel=all` désigne « tous les carburants » : l'absence du paramètre vaut
 * Gazole, pour qu'une première visite affiche directement des prix sur la carte.
 * Même convention pour `brand=all` : l'absence vaut TotalEnergies.
 *
 * Une enseigne inconnue n'est pas « aberrante » : la liste dépend de la zone,
 * on ne peut pas la valider ici. Elle est transmise telle quelle et donnera au
 * pire une liste vide, que l'écran explique.
 */
export function parseFuelSearchParams(
  sp: Record<string, string | string[] | undefined>,
): FuelSearchParams {
  const lat = parseFloat(first(sp.lat) ?? '');
  const lng = parseFloat(first(sp.lng) ?? '');
  const located =
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

  const radiusRaw = Number(first(sp.radius));
  const radiusKm = (RADIUS_OPTIONS as readonly number[]).includes(radiusRaw)
    ? radiusRaw
    : DEFAULT_RADIUS_KM;

  const fuelRaw = first(sp.fuel) ?? '';
  const fuel = fuelRaw === 'all' ? null : isFuelCode(fuelRaw) ? fuelRaw : DEFAULT_FUEL;

  // Sans carburant, aucun prix à comparer : le tri par prix n'existe pas.
  const sort: FuelSort = fuel !== null && first(sp.sort) !== 'distance' ? 'price' : 'distance';

  const brandRaw = (first(sp.brand) ?? '').trim();
  const brand =
    brandRaw === 'all'
      ? null
      : brandRaw === '' || brandRaw.length > MAX_BRAND_LENGTH
        ? DEFAULT_BRAND
        : brandRaw;

  return {
    lat: located ? lat : DEFAULT_CENTER.lat,
    lng: located ? lng : DEFAULT_CENTER.lng,
    radiusKm,
    fuel,
    sort,
    brand,
    located,
  };
}

/** 4 décimales ≈ 11 m : assez précis pour une station, et des URL lisibles. */
function round(coordinate: number): string {
  return coordinate.toFixed(4);
}

/** Query string de l'API backend — toujours complète, jamais de défaut implicite. */
export function buildFuelApiQuery(params: FuelSearchParams): string {
  const sp = new URLSearchParams({
    lat: round(params.lat),
    lng: round(params.lng),
    radiusKm: String(params.radiusKm),
    sort: params.sort,
  });
  if (params.fuel !== null) sp.set('fuel', params.fuel);
  if (params.brand !== null) sp.set('brand', params.brand);
  return `?${sp.toString()}`;
}

/** URL de la page, défauts omis pour garder des liens courts. */
export function buildFuelPageHref(params: Partial<FuelSearchParams>): string {
  const sp = new URLSearchParams();
  if (params.located && params.lat !== undefined && params.lng !== undefined) {
    sp.set('lat', round(params.lat));
    sp.set('lng', round(params.lng));
  }
  if (params.radiusKm !== undefined && params.radiusKm !== DEFAULT_RADIUS_KM) {
    sp.set('radius', String(params.radiusKm));
  }
  if (params.fuel === null) sp.set('fuel', 'all');
  else if (params.fuel !== undefined && params.fuel !== DEFAULT_FUEL) sp.set('fuel', params.fuel);
  if (params.fuel !== null && params.sort === 'distance') sp.set('sort', 'distance');
  if (params.brand === null) sp.set('brand', 'all');
  else if (params.brand !== undefined && params.brand !== DEFAULT_BRAND) sp.set('brand', params.brand);
  const qs = sp.toString();
  return qs ? `/fuel?${qs}` : '/fuel';
}

/** Prix à la pompe : trois décimales, comme sur les totems des stations. */
export function formatLiterPrice(price: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(price);
}

export function formatDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1).replace('.', ',')} km`;
}

function comparable(value: string): string {
  return value.normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
}

/**
 * Libellé d'une station : l'enseigne en titre, et le nom OpenStreetMap en
 * complément seulement s'il apporte quelque chose — « Carrefour » sous
 * « Carrefour » est du bruit, « Aire de Saint-Rémy (A31) » ne l'est pas.
 *
 * Sans enseigne (station absente d'OSM, ~5 %), le nom tient lieu de titre ;
 * sans l'un ni l'autre, on le dit plutôt que d'inventer.
 */
export function stationLabel(
  station: Pick<FuelStation, 'brand' | 'name'>,
): { title: string; detail: string | null } {
  const { brand, name } = station;
  if (brand === null) return { title: name ?? 'Enseigne inconnue', detail: null };
  const redundant = name === null || comparable(name) === comparable(brand);
  return { title: brand, detail: redundant ? null : name };
}

/**
 * Options du sélecteur d'enseigne : celles que l'API a trouvées dans la zone,
 * plus l'enseigne choisie si elle n'y est pas — sinon le `<select>` afficherait
 * une autre valeur que celle réellement filtrée.
 */
export function brandOptions(brands: BrandCount[], selected: string | null): BrandCount[] {
  if (selected === null || brands.some((entry) => entry.brand === selected)) return brands;
  return [...brands, { brand: selected, stationCount: 0 }].sort((a, b) =>
    a.brand.localeCompare(b.brand, 'fr', { sensitivity: 'base' }),
  );
}

/**
 * Lien Google Maps vers une station (API « Maps URLs », sans clé ni quota) :
 * ouvre l'application sur mobile, le site sinon.
 *
 * Recherche **textuelle** « enseigne, adresse, code postal ville » : Google la
 * résout en fiche de lieu (la station elle-même, avec son nom et ses horaires),
 * d'où l'itinéraire mène à l'entrée de la station plutôt qu'à un point GPS.
 * L'enseigne aide à tomber sur la station plutôt que sur le simple numéro de
 * rue — utile pour les adresses vagues (« RN 7 », « Centre commercial »).
 *
 * Sans adresse dans le flux officiel, on se rabat sur les coordonnées : une
 * épingle exacte vaut mieux qu'une recherche sur la seule ville.
 */
export function googleMapsUrl(
  station: Pick<FuelStation, 'brand' | 'name' | 'address' | 'postcode' | 'city' | 'latitude' | 'longitude'>,
): string {
  const address = station.address.trim();
  const query = address
    ? [station.brand ?? station.name, address, `${station.postcode} ${station.city}`.trim()]
        .filter((part): part is string => Boolean(part))
        .join(', ')
    : `${station.latitude},${station.longitude}`;
  const sp = new URLSearchParams({ api: '1', query });
  return `https://www.google.com/maps/search/?${sp.toString()}`;
}

export function fuelOf(station: FuelStation, code: FuelCode): FuelPrice | null {
  return station.fuels.find((fuel) => fuel.code === code) ?? null;
}

export type PriceTier = 'low' | 'mid' | 'high';

/**
 * Classe un prix par rapport aux autres stations affichées : tiers le moins
 * cher, tiers médian, tiers le plus cher. C'est une comparaison locale, pas un
 * jugement absolu — un prix « bas » à Paris peut être élevé ailleurs.
 *
 * Seuls les prix disponibles servent de référence ; moins de trois, et il n'y
 * a rien à classer.
 */
export function priceTiers(
  stations: FuelStation[],
  code: FuelCode,
): (price: number) => PriceTier | null {
  const prices = stations
    .map((station) => fuelOf(station, code))
    .filter((fuel): fuel is FuelPrice => fuel !== null && fuel.available && fuel.price !== null)
    .map((fuel) => fuel.price as number)
    .sort((a, b) => a - b);

  if (prices.length < 3) return () => null;

  const lowMax = prices[Math.floor((prices.length - 1) / 3)];
  const midMax = prices[Math.floor((2 * (prices.length - 1)) / 3)];
  return (price) => (price <= lowMax ? 'low' : price <= midMax ? 'mid' : 'high');
}

// --- Prévision de rupture (page « Mes stations ») --------------------------------

/**
 * Fuseau des dates affichées. Explicite : la page est rendue côté serveur, dans
 * un Pod réglé en UTC — sans lui, « avant 11 h 30 » voudrait dire 12 h 30 à
 * Paris en hiver.
 */
const DISPLAY_TIME_ZONE = 'Europe/Paris';

const dayKey = new Intl.DateTimeFormat('fr-FR', {
  timeZone: DISPLAY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const clock = new Intl.DateTimeFormat('fr-FR', {
  timeZone: DISPLAY_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
});
const weekdayDate = new Intl.DateTimeFormat('fr-FR', {
  timeZone: DISPLAY_TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/** Probabilité en pourcentage entier — au-delà, une précision que le modèle n'a pas. */
export function formatRisk(risk: number): string {
  if (risk > 0 && risk < 0.01) return '< 1 %';
  return `${Math.round(risk * 100)} %`;
}

/**
 * Échéance lisible, heure de Paris : « aujourd'hui à 18:30 », « demain à
 * 11:30 », sinon « le jeu. 7 nov. à 11:30 ».
 */
export function formatDeadline(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const time = clock.format(date);
  const day = dayKey.format(date);
  if (day === dayKey.format(now)) return `aujourd’hui à ${time}`;
  if (day === dayKey.format(new Date(now.getTime() + 86_400_000))) return `demain à ${time}`;
  return `le ${weekdayDate.format(date)} à ${time}`;
}

export const RISK_LEVEL_LABELS: Record<ShortageRiskLevel, string> = {
  low: 'Risque faible',
  elevated: 'Risque élevé',
  likely: 'Rupture probable',
};

/**
 * Phrase d'une prévision. Le modèle ne prédit pas une date mais une
 * probabilité sur 24 h : la seule date honnête est la fin de cet horizon, d'où
 * « avant… » / « d'ici… » plutôt qu'un « le … à … » qui promettrait une heure.
 */
export function outlookSentence(outlook: ShortageOutlook, now: Date = new Date()): string {
  const deadline = formatDeadline(outlook.horizonEnd, now);
  switch (outlook.level) {
    case 'likely':
      return `Rupture probable avant ${deadline}`;
    case 'elevated':
      return `Risque de rupture élevé d’ici ${deadline}`;
    case 'low':
      return `Pas de rupture attendue d’ici ${deadline}`;
  }
}

export const RESTOCK_LEVEL_LABELS: Record<RestockChanceLevel, string> = {
  unlikely: 'Retour peu probable',
  possible: 'Retour possible',
  likely: 'Retour probable',
};

/**
 * Phrase d'une prévision de réapprovisionnement — même règle que
 * `outlookSentence` : une échéance (« avant… »), jamais une heure de retour.
 */
export function restockSentence(outlook: RestockOutlook, now: Date = new Date()): string {
  const deadline = formatDeadline(outlook.horizonEnd, now);
  switch (outlook.level) {
    case 'likely':
      return `Retour probable avant ${deadline}`;
    case 'possible':
      return `Retour possible d’ici ${deadline}`;
    case 'unlikely':
      return `Retour peu probable d’ici ${deadline}`;
  }
}

/** Calcul le plus récent parmi des dates ISO (ou null), null si aucune. */
export function latestComputedAt(...dates: (string | null)[]): string | null {
  return dates.reduce<string | null>(
    (latest, date) => (date !== null && (latest === null || date > latest) ? date : latest),
    null,
  );
}

const LEVEL_RANK: Record<ShortageRiskLevel, number> = { low: 0, elevated: 1, likely: 2 };

/** Pire niveau parmi les carburants prévus d'une station, null si aucun. */
export function worstRiskLevel(fuels: FavoriteFuel[]): ShortageRiskLevel | null {
  return fuels.reduce<ShortageRiskLevel | null>((worst, fuel) => {
    const level = fuel.shortageOutlook?.level ?? null;
    if (level === null) return worst;
    return worst === null || LEVEL_RANK[level] > LEVEL_RANK[worst] ? level : worst;
  }, null);
}

/** Carburants dans l'ordre d'affichage habituel (du plus vendu au plus rare). */
export function sortFuels<T extends { code: FuelCode }>(fuels: T[]): T[] {
  return [...fuels].sort((a, b) => FUEL_CODES.indexOf(a.code) - FUEL_CODES.indexOf(b.code));
}

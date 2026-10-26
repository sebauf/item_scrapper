import type { FuelCode, FuelPrice, FuelStation } from './api';

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

  return {
    lat: located ? lat : DEFAULT_CENTER.lat,
    lng: located ? lng : DEFAULT_CENTER.lng,
    radiusKm,
    fuel,
    sort,
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
export function stationLabel(station: FuelStation): { title: string; detail: string | null } {
  const { brand, name } = station;
  if (brand === null) return { title: name ?? 'Enseigne inconnue', detail: null };
  const redundant = name === null || comparable(name) === comparable(brand);
  return { title: brand, detail: redundant ? null : name };
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

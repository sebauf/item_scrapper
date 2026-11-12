import type {
  FavoriteFuel,
  FavoriteStationDetails,
  FavoriteStationDetailsList,
  FuelCode,
  FuelPrice,
  FuelStation,
  FuelStationSearchResult,
  RestockChanceLevel,
  ShortageRiskLevel,
} from './backend/client.js';
import { formatParisDateTime, formatParisDay } from './format-time.js';

/**
 * Mise en forme des réponses carburant pour un lecteur qui est un modèle.
 *
 * Même parti pris que `format.ts` : du texte compact plutôt que le JSON du
 * backend, en gardant toujours l'identifiant officiel de la station — c'est la
 * clé de add_favorite_station / remove_favorite_station.
 *
 * Les dates sont rendues en **heure de Paris** (cf. `format-time.ts`).
 */

const FUEL_LABELS: Record<FuelCode, string> = {
  gazole: 'Gazole',
  e10: 'SP95-E10',
  sp98: 'SP98',
  sp95: 'SP95',
  e85: 'E85',
  gplc: 'GPLc',
};

export function fuelLabel(code: FuelCode): string {
  return FUEL_LABELS[code];
}

const SHORTAGE_LEVELS: Record<ShortageRiskLevel, string> = {
  low: 'faible',
  elevated: 'élevé',
  likely: 'probable',
};

const RESTOCK_LEVELS: Record<RestockChanceLevel, string> = {
  unlikely: 'peu probable',
  possible: 'possible',
  likely: 'probable',
};

function percent(probability: number): string {
  return `${Math.round(probability * 100)} %`;
}

/**
 * Une ligne par carburant : prix et date de déclaration, ou rupture.
 * « ancien » reprend le verdict du backend (`isStale`), sans le recalculer.
 */
export function formatFuelPrice(fuel: FuelPrice): string {
  const label = fuelLabel(fuel.code);
  if (!fuel.available) {
    const since = fuel.shortageSince === null ? '' : ` depuis ${formatParisDateTime(fuel.shortageSince)}`;
    return `${label} : RUPTURE${since}`;
  }
  const price = fuel.price === null ? 'prix inconnu' : `${fuel.price.toFixed(3)} €/L`;
  const stale = fuel.isStale ? 'ANCIEN, ' : '';
  return `${label} : ${price} (${stale}déclaré ${formatParisDateTime(fuel.updatedAt)})`;
}

function roadLabel(roadType: FuelStation['roadType']): string | null {
  if (roadType === 'A') return 'autoroute';
  return null;
}

type StationIdentity = Pick<FuelStation, 'brand' | 'name' | 'address' | 'postcode' | 'city' | 'roadType'>;

/** « TotalEnergies — 12 avenue Félix Faure, 69003 Lyon » (le nom OSM ne sert que sans enseigne). */
function stationTitle(station: StationIdentity): string {
  const label = station.brand ?? station.name ?? 'Enseigne inconnue';
  const road = roadLabel(station.roadType);
  return `${label} — ${station.address}, ${station.postcode} ${station.city}${road ? ` (${road})` : ''}`;
}

/**
 * Avec un filtre `fuel`, seul ce carburant est affiché : c'est la question
 * posée, et les autres prix coûteraient des jetons pour rien.
 */
export function formatFuelStation(station: FuelStation, fuel: FuelCode | undefined): string {
  const fuels = fuel === undefined ? station.fuels : station.fuels.filter((f) => f.code === fuel);
  const lines = [
    `- ${stationTitle(station)} — ${station.distanceKm.toFixed(1)} km${station.isFavorite ? ' — FAVORITE' : ''}`,
    `  id: ${station.id}`,
    ...(fuels.length === 0
      ? ['  aucun carburant déclaré']
      : fuels.map((f) => `  ${formatFuelPrice(f)}`)),
  ];
  return lines.join('\n');
}

export interface FuelSearchDisplay {
  radiusKm: number;
  fuel: FuelCode | undefined;
  limit: number;
}

export function formatFuelStationSearch(
  result: FuelStationSearchResult,
  display: FuelSearchDisplay,
): string {
  const shown = result.stations.slice(0, display.limit);
  const total = result.truncated ? `plus de ${result.stations.length}` : String(result.stations.length);

  const header = [
    `${total} station(s) dans un rayon de ${display.radiusKm} km` +
      (display.fuel === undefined ? '' : ` vendant du ${fuelLabel(display.fuel)}`) +
      (shown.length < result.stations.length ? `, les ${shown.length} premières affichées.` : '.'),
    `Dernier import du flux officiel : ${formatParisDateTime(result.lastImportAt)} (heure de Paris). ` +
      `Un prix déclaré il y a plus de ${result.staleAfterHours} h est marqué ANCIEN.`,
  ];
  if (result.brands.length > 0) {
    header.push(
      'Enseignes dans la zone : ' +
        result.brands.map((b) => `${b.brand} (${b.stationCount})`).join(', ') +
        ' — source © contributeurs OpenStreetMap (ODbL).',
    );
  }

  if (shown.length === 0) {
    return [...header, '', 'Aucune station ne correspond. Élargir le rayon ou retirer un filtre.'].join('\n');
  }
  return [...header, '', ...shown.map((station) => formatFuelStation(station, display.fuel))].join('\n');
}

/**
 * Une prévision n'est jamais une date : le modèle dit « un événement survient
 * dans les 24 h », d'où le seul énoncé honnête, « avant <fin de l'horizon> ».
 */
export function formatFavoriteFuel(fuel: FavoriteFuel): string {
  const base = formatFuelPrice(fuel);
  if (fuel.available) {
    const outlook = fuel.shortageOutlook;
    if (outlook === null) return `${base} — pas de prévision de rupture`;
    return (
      `${base} — risque de rupture avant ${formatParisDateTime(outlook.horizonEnd)} : ` +
      `${percent(outlook.risk)} (${SHORTAGE_LEVELS[outlook.level]})`
    );
  }
  const outlook = fuel.restockOutlook;
  if (outlook === null) return `${base} — pas de prévision de retour`;
  return (
    `${base} — retour à la pompe avant ${formatParisDateTime(outlook.horizonEnd)} : ` +
    `${percent(outlook.probability)} (${RESTOCK_LEVELS[outlook.level]})`
  );
}

function formatFavoriteStation(favorite: FavoriteStationDetails): string {
  const added = `ajoutée le ${formatParisDay(favorite.addedAt)}`;
  if (favorite.station === null) {
    return [
      `- Station ${favorite.id} — absente du flux officiel actuellement (${added})`,
      `  id: ${favorite.id}`,
    ].join('\n');
  }
  const { station } = favorite;
  return [
    `- ${stationTitle(station)} (${added})`,
    `  id: ${favorite.id} | position: ${station.latitude}, ${station.longitude}`,
    ...(station.fuels.length === 0
      ? ['  aucun carburant déclaré']
      : station.fuels.map((f) => `  ${formatFavoriteFuel(f)}`)),
  ].join('\n');
}

export function formatFavoriteStations(list: FavoriteStationDetailsList): string {
  if (list.stations.length === 0) {
    return (
      'Aucune station favorite. Trouver une station avec find_fuel_stations, puis ' +
      "l'ajouter avec add_favorite_station(id)."
    );
  }
  const header = [
    `${list.stations.length} station(s) favorite(s), de la plus récente à la plus ancienne. ` +
      'Heures de Paris.',
    `Prévisions à ${list.forecast.horizonHours} h : risque de rupture pour un carburant disponible ` +
      `(élevé ≥ ${percent(list.forecast.elevatedThreshold)}, probable ≥ ${percent(list.forecast.likelyThreshold)}), ` +
      `chance de retour pour un carburant en rupture ` +
      `(possible ≥ ${percent(list.restockForecast.possibleThreshold)}, probable ≥ ${percent(list.restockForecast.likelyThreshold)}).`,
  ];
  return [...header, '', ...list.stations.map(formatFavoriteStation)].join('\n');
}

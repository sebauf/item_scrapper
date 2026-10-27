'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { FuelStationSearchResult } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import {
  brandOptions,
  buildFuelPageHref,
  DEFAULT_CENTER,
  FUEL_CODES,
  FUEL_LABELS,
  priceTiers,
  RADIUS_OPTIONS,
  type FuelSearchParams,
} from '@/lib/fuel';
import { FuelStationList } from './FuelStationList';

// Leaflet lit `window` à l'import : la carte n'est jamais rendue côté serveur.
const FuelMap = dynamic(() => import('./FuelMap'), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-surface-hover" />,
});

/** Distance approximative en km entre deux points proches (équirectangulaire). */
function roughDistanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const x = (b.lng - a.lng) * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const y = b.lat - a.lat;
  return Math.sqrt(x * x + y * y) * 111.32;
}

type GeoStatus = 'idle' | 'pending' | 'denied' | 'unavailable';

export interface FuelExplorerProps {
  params: FuelSearchParams;
  result: FuelStationSearchResult;
}

/**
 * Écran interactif : carte + liste + filtres.
 *
 * Toute recherche passe par l'URL (`router.push`) : c'est la page serveur qui
 * appelle le backend, injoignable depuis le navigateur (Service ClusterIP sans
 * ingress, cf. lib/api.ts). Une recherche est donc un lien partageable.
 */
export function FuelExplorer({ params, result }: FuelExplorerProps) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapCenter, setMapCenter] = useState({ lat: params.lat, lng: params.lng });
  const [geoStatus, setGeoStatus] = useState<GeoStatus>('idle');

  const tierOf = useMemo(
    () => (params.fuel ? priceTiers(result.stations, params.fuel) : () => null),
    [result.stations, params.fuel],
  );

  // Le bouton n'apparaît qu'une fois la carte sortie d'un quart du rayon :
  // en deçà, la recherche renverrait presque les mêmes stations.
  const movedAway = roughDistanceKm(params, mapCenter) > params.radiusKm / 4;

  function go(next: Partial<FuelSearchParams>) {
    setSelectedId(null);
    router.push(buildFuelPageHref({ ...params, ...next }));
  }

  function locate() {
    if (!('geolocation' in navigator)) {
      setGeoStatus('unavailable');
      return;
    }
    setGeoStatus('pending');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setGeoStatus('idle');
        go({ lat: coords.latitude, lng: coords.longitude, located: true });
      },
      // Refus de l'utilisateur, ou page servie en HTTP : les navigateurs
      // n'exposent la géolocalisation qu'en contexte sécurisé (HTTPS, localhost).
      (error) => setGeoStatus(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }

  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
      active
        ? 'bg-accent text-on-accent border-accent'
        : 'bg-surface text-muted border-border hover:text-foreground hover:bg-surface-hover'
    }`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {FUEL_CODES.map((code) => (
          <Link key={code} href={buildFuelPageHref({ ...params, fuel: code })} className={chip(params.fuel === code)}>
            {FUEL_LABELS[code]}
          </Link>
        ))}
        <Link href={buildFuelPageHref({ ...params, fuel: null })} className={chip(params.fuel === null)}>
          Tous
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button
          type="button"
          onClick={locate}
          disabled={geoStatus === 'pending'}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 font-medium text-on-accent hover:bg-accent-hover disabled:opacity-60"
        >
          📍 {geoStatus === 'pending' ? 'Localisation…' : 'Me localiser'}
        </button>

        <label className="inline-flex items-center gap-1.5 text-muted">
          Rayon
          <select
            value={params.radiusKm}
            onChange={(event) => go({ radiusKm: Number(event.target.value) })}
            className="rounded-lg border border-border bg-surface px-2 py-1 text-foreground"
          >
            {RADIUS_OPTIONS.map((km) => (
              <option key={km} value={km}>
                {km} km
              </option>
            ))}
          </select>
        </label>

        <label className="inline-flex items-center gap-1.5 text-muted">
          Enseigne
          {/* Valeur « all » plutôt que "" : c'est déjà le mot de l'URL pour « toutes ». */}
          <select
            value={params.brand ?? 'all'}
            onChange={(event) => go({ brand: event.target.value === 'all' ? null : event.target.value })}
            className="rounded-lg border border-border bg-surface px-2 py-1 text-foreground"
          >
            <option value="all">Toutes</option>
            {brandOptions(result.brands, params.brand).map(({ brand, stationCount }) => (
              <option key={brand} value={brand}>
                {brand} ({stationCount})
              </option>
            ))}
          </select>
        </label>

        {params.fuel !== null && (
          <label className="inline-flex items-center gap-1.5 text-muted">
            Trier par
            <select
              value={params.sort}
              onChange={(event) => go({ sort: event.target.value === 'distance' ? 'distance' : 'price' })}
              className="rounded-lg border border-border bg-surface px-2 py-1 text-foreground"
            >
              <option value="price">prix</option>
              <option value="distance">distance</option>
            </select>
          </label>
        )}

        <span className="text-xs text-faint ml-auto">
          {result.lastImportAt
            ? `Prix officiels importés ${timeAgo(result.lastImportAt)}`
            : 'Aucun import du flux officiel pour le moment'}
        </span>
      </div>

      {!params.located && geoStatus === 'idle' && (
        <p className="text-xs text-muted">
          Position par défaut : {DEFAULT_CENTER.label}. Localisez-vous, ou déplacez la carte puis
          relancez la recherche.
        </p>
      )}
      {geoStatus === 'denied' && (
        <p className="text-xs text-warn">
          Géolocalisation refusée. Déplacez la carte jusqu’à votre zone puis « Rechercher ici ».
        </p>
      )}
      {geoStatus === 'unavailable' && (
        <p className="text-xs text-warn">
          Géolocalisation indisponible (elle exige une page servie en HTTPS). Déplacez la carte
          puis « Rechercher ici ».
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="relative h-[55vh] lg:h-[calc(100vh-14rem)] overflow-hidden rounded-2xl border border-border">
          <FuelMap
            center={{ lat: params.lat, lng: params.lng }}
            radiusKm={params.radiusKm}
            stations={result.stations}
            fuel={params.fuel}
            tierOf={tierOf}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onMoveEnd={setMapCenter}
          />
          {movedAway && (
            <button
              type="button"
              onClick={() => go({ lat: mapCenter.lat, lng: mapCenter.lng, located: true })}
              className="absolute left-1/2 top-3 z-[1000] -translate-x-1/2 rounded-full bg-surface px-4 py-2 text-sm font-medium text-foreground shadow-lg border border-border hover:bg-surface-hover"
            >
              🔍 Rechercher ici
            </button>
          )}
        </div>

        <div className="lg:h-[calc(100vh-14rem)] lg:overflow-y-auto lg:pr-1">
          <p className="mb-2 text-sm text-muted">
            {result.stations.length} station{result.stations.length > 1 ? 's' : ''}
            {params.brand !== null && ` ${params.brand}`} à moins de{' '}
            {params.radiusKm} km
            {result.truncated && ' (liste plafonnée — réduisez le rayon pour tout voir)'}
            {' · '}
            <span title={`Prix déclarés il y a plus de ${result.staleAfterHours} h`}>⚠️ = prix ancien</span>
            {' · '}
            <span title="Une station favorite déclenche une alerte quand un carburant y redevient disponible">
              ★ = alerte de réapprovisionnement
            </span>
          </p>
          <FuelStationList
            stations={result.stations}
            fuel={params.fuel}
            brand={params.brand}
            tierOf={tierOf}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>
      </div>
    </div>
  );
}

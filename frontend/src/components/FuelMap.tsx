'use client';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useMemo, useRef } from 'react';
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import type { FuelCode, FuelStation } from '@/lib/api';
import { formatDistance, fuelOf, stationLabel, type PriceTier } from '@/lib/fuel';
import { FuelBadge } from './FuelStationList';

/**
 * Carte Leaflet des stations.
 *
 * Chargée uniquement côté navigateur (cf. `dynamic(..., { ssr: false })` dans
 * FuelExplorer) : Leaflet lit `window` dès son import et ferait échouer le
 * rendu serveur.
 *
 * Fond OpenStreetMap : gratuit, sans clé, mais soumis à sa politique d'usage
 * (attribution obligatoire, trafic modéré) — adapté à un usage personnel. Pour
 * un trafic public, il faudrait un fournisseur de tuiles dédié.
 */

/** Zoom qui fait tenir le cercle de recherche dans une carte d'environ 600 px. */
const ZOOM_BY_RADIUS: Record<number, number> = { 5: 12, 10: 11, 20: 10, 30: 9 };

export interface FuelMapProps {
  center: { lat: number; lng: number };
  radiusKm: number;
  stations: FuelStation[];
  fuel: FuelCode | null;
  tierOf: (price: number) => PriceTier | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMoveEnd: (center: { lat: number; lng: number }) => void;
}

/**
 * Repère HTML (divIcon) plutôt que l'image par défaut de Leaflet : celle-ci
 * est référencée par un chemin relatif que les bundlers cassent, et un prix
 * lisible directement sur la carte vaut mieux qu'une épingle muette.
 *
 * `iconSize: undefined` laisse le repère prendre la largeur de son texte ; le
 * centrage sous le point se fait en CSS (.fuel-pin, globals.css).
 */
function pinIcon(label: string | null, tone: string, active: boolean): L.DivIcon {
  const html = label
    ? `<div class="fuel-pin fuel-pin--${tone}${active ? ' fuel-pin--active' : ''}">${label}</div>`
    : `<div class="fuel-dot fuel-pin--${tone}${active ? ' fuel-pin--active' : ''}"></div>`;
  return L.divIcon({ className: '', html, iconSize: undefined });
}

function markerFor(station: FuelStation, fuel: FuelCode | null, tierOf: FuelMapProps['tierOf'], active: boolean) {
  if (fuel === null) return pinIcon(null, 'neutral', active);
  const selected = fuelOf(station, fuel);
  if (!selected || !selected.available || selected.price === null) return pinIcon('rupture', 'out', active);
  const label = selected.price.toFixed(3).replace('.', ',');
  const tone = selected.isStale ? 'stale' : (tierOf(selected.price) ?? 'neutral');
  return pinIcon(label, tone, active);
}

function Recenter({ center, radiusKm }: Pick<FuelMapProps, 'center' | 'radiusKm'>) {
  const map = useMap();
  useEffect(() => {
    map.setView([center.lat, center.lng], ZOOM_BY_RADIUS[radiusKm] ?? 11);
  }, [map, center.lat, center.lng, radiusKm]);
  return null;
}

function MoveListener({ onMoveEnd }: Pick<FuelMapProps, 'onMoveEnd'>) {
  const map = useMapEvents({
    moveend: () => {
      const { lat, lng } = map.getCenter();
      onMoveEnd({ lat, lng });
    },
  });
  return null;
}

function FocusSelected({
  station,
  markers,
}: {
  station: FuelStation | null;
  markers: React.RefObject<Map<string, L.Marker>>;
}) {
  const map = useMap();
  useEffect(() => {
    if (!station) return;
    // La popup s'ouvre à l'arrivée, pas au départ : son auto-panoramique
    // interromprait le vol et laisserait la carte figée en pleine animation.
    const open = () => markers.current.get(station.id)?.openPopup();
    map.once('moveend', open);
    map.flyTo([station.latitude, station.longitude], Math.max(map.getZoom(), 14), { duration: 0.6 });
    return () => {
      map.off('moveend', open);
    };
  }, [map, station, markers]);
  return null;
}

export default function FuelMap({
  center,
  radiusKm,
  stations,
  fuel,
  tierOf,
  selectedId,
  onSelect,
  onMoveEnd,
}: FuelMapProps) {
  const markers = useRef(new Map<string, L.Marker>());
  const selected = useMemo(
    () => stations.find((station) => station.id === selectedId) ?? null,
    [stations, selectedId],
  );

  return (
    <MapContainer
      center={[center.lat, center.lng]}
      zoom={ZOOM_BY_RADIUS[radiusKm] ?? 11}
      scrollWheelZoom
      className="h-full w-full"
    >
      <TileLayer
        // Couvre aussi les enseignes, tirées d'OSM (licence ODbL, cf. pipeline/src/fuel/brands.py).
        attribution='&copy; contributeurs <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> (fond et enseignes)'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <Recenter center={center} radiusKm={radiusKm} />
      <MoveListener onMoveEnd={onMoveEnd} />
      <FocusSelected station={selected} markers={markers} />
      <Circle
        center={[center.lat, center.lng]}
        radius={radiusKm * 1000}
        pathOptions={{ color: '#4f46e5', weight: 1, fillOpacity: 0.04 }}
      />
      {stations.map((station) => {
        const label = stationLabel(station);
        return (
          <Marker
            key={station.id}
            position={[station.latitude, station.longitude]}
            title={label.title}
            icon={markerFor(station, fuel, tierOf, station.id === selectedId)}
            zIndexOffset={station.id === selectedId ? 1000 : 0}
            eventHandlers={{ click: () => onSelect(station.id) }}
            ref={(marker) => {
              if (marker) markers.current.set(station.id, marker);
              else markers.current.delete(station.id);
            }}
          >
            <Popup>
              <div className="flex flex-col items-start gap-1 min-w-48">
                <p className="font-semibold">
                  {label.title}
                  {label.detail && <span className="font-normal opacity-70"> · {label.detail}</span>}
                </p>
                <p>{station.address || 'Adresse inconnue'}</p>
                <p className="text-xs opacity-70">
                  {station.postcode} {station.city} · {formatDistance(station.distanceKm)}
                  {station.roadType === 'A' && ' · autoroute'}
                </p>
                <div className="flex flex-wrap gap-1">
                  {station.fuels.map((f) => (
                    <FuelBadge
                      key={f.code}
                      fuel={f}
                      tier={f.code === fuel && f.price !== null ? tierOf(f.price) : null}
                      emphasized={f.code === fuel}
                    />
                  ))}
                </div>
                <a
                  href={`https://www.openstreetmap.org/directions?to=${station.latitude},${station.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-xs"
                >
                  Itinéraire ↗
                </a>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}

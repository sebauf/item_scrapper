import type { FuelCode, FuelPrice, FuelStation } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import {
  FUEL_LABELS,
  formatDistance,
  formatLiterPrice,
  fuelOf,
  stationLabel,
  type PriceTier,
} from '@/lib/fuel';
import { FavoriteStationButton } from './FavoriteStationButton';

const TIER_CLASSES: Record<PriceTier, string> = {
  low: 'bg-deal-soft text-deal border-deal-border',
  mid: 'bg-surface-hover text-foreground border-border',
  high: 'bg-warn-soft text-warn border-warn-border',
};

/** Pastille d'un carburant : prix, rupture, ou prix ancien à vérifier. */
export function FuelBadge({
  fuel,
  tier = null,
  emphasized = false,
}: {
  fuel: FuelPrice;
  tier?: PriceTier | null;
  emphasized?: boolean;
}) {
  const label = FUEL_LABELS[fuel.code];

  if (!fuel.available) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-lg border border-danger/30 bg-danger-soft px-2 py-0.5 text-xs text-danger"
        title={fuel.shortageSince ? `Rupture depuis le ${new Date(fuel.shortageSince).toLocaleString('fr-FR')}` : 'Rupture déclarée'}
      >
        <span className="font-medium">{label}</span>
        <span>rupture</span>
      </span>
    );
  }

  const tone = tier ? TIER_CLASSES[tier] : 'bg-surface-hover text-foreground border-border';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs ${tone} ${
        emphasized ? 'ring-2 ring-accent/40' : ''
      }`}
      title={fuel.updatedAt ? `Déclaré ${timeAgo(fuel.updatedAt)}` : 'Date de déclaration inconnue'}
    >
      <span className="font-medium">{label}</span>
      <span className="tabular-nums font-semibold">{formatLiterPrice(fuel.price as number)}</span>
      {fuel.isStale && (
        <span aria-label="prix ancien, à vérifier" title="Prix ancien, à vérifier">
          ⚠️
        </span>
      )}
    </span>
  );
}

export interface FuelStationListProps {
  stations: FuelStation[];
  fuel: FuelCode | null;
  tierOf: (price: number) => PriceTier | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function FuelStationList({ stations, fuel, tierOf, selectedId, onSelect }: FuelStationListProps) {
  if (stations.length === 0) {
    return (
      <p className="rounded-2xl border border-border bg-surface px-4 py-8 text-center text-sm text-muted">
        Aucune station dans cette zone{fuel ? ` ne vend de ${FUEL_LABELS[fuel]}` : ''}. Élargissez le
        rayon ou déplacez la carte.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {stations.map((station) => {
        const selected = fuel ? fuelOf(station, fuel) : null;
        const active = station.id === selectedId;
        const label = stationLabel(station);
        const freshest = station.fuels
          .map((f) => f.updatedAt)
          .filter((d): d is string => d !== null)
          .sort()
          .at(-1);

        return (
          // L'étoile est une sœur du bouton de sélection, pas une enfant : un
          // bouton dans un bouton est du HTML invalide.
          <li key={station.id} className="relative">
            <button
              type="button"
              onClick={() => onSelect(station.id)}
              aria-pressed={active}
              className={`w-full text-left rounded-2xl border py-3 pl-4 pr-14 transition-colors ${
                active
                  ? 'border-accent bg-accent-soft'
                  : 'border-border bg-surface hover:bg-surface-hover'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-foreground truncate">
                    {label.title}
                    {label.detail && <span className="font-normal text-muted"> · {label.detail}</span>}
                  </p>
                  <p className="text-sm text-foreground/80 truncate">{station.address || 'Adresse inconnue'}</p>
                  <p className="text-xs text-muted">
                    {station.postcode} {station.city} · {formatDistance(station.distanceKm)}
                    {station.roadType === 'A' && ' · autoroute'}
                  </p>
                </div>
                {selected && selected.available && selected.price !== null && (
                  <p className="text-lg font-bold tabular-nums text-foreground shrink-0">
                    {formatLiterPrice(selected.price)}
                  </p>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {station.fuels.map((f) => (
                  <FuelBadge
                    key={f.code}
                    fuel={f}
                    tier={f.code === fuel && f.price !== null ? tierOf(f.price) : null}
                    emphasized={f.code === fuel}
                  />
                ))}
              </div>
              {freshest && <p className="mt-1.5 text-[11px] text-faint">Dernière déclaration {timeAgo(freshest)}</p>}
            </button>
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <FavoriteStationButton
                // `key` : un nouveau résultat serveur doit réinitialiser l'état optimiste.
                key={String(station.isFavorite)}
                stationId={station.id}
                initialFavorite={station.isFavorite}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

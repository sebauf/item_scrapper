import type {
  FavoriteFuel,
  FavoriteStationDetails,
  RestockChanceLevel,
  ShortageRiskLevel,
} from '@/lib/api';
import { timeAgo } from '@/lib/format';
import {
  FUEL_LABELS,
  formatLiterPrice,
  formatRisk,
  googleMapsUrl,
  outlookSentence,
  restockSentence,
  RISK_LEVEL_LABELS,
  sortFuels,
  stationLabel,
  worstRiskLevel,
} from '@/lib/fuel';
import { FavoriteStationButton } from './FavoriteStationButton';

const LEVEL_CLASSES: Record<ShortageRiskLevel, string> = {
  low: 'bg-deal-soft text-deal border-deal-border',
  elevated: 'bg-warn-soft text-warn border-warn-border',
  likely: 'bg-danger-soft text-danger border-danger/30',
};

/** Un retour probable est une bonne nouvelle : vert ; peu probable, neutre. */
const RESTOCK_CLASSES: Record<RestockChanceLevel, string> = {
  likely: LEVEL_CLASSES.low,
  possible: LEVEL_CLASSES.elevated,
  unlikely: 'bg-surface-hover text-muted border-border',
};

function Badge({ classes, children }: { classes: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-medium ${classes}`}
    >
      {children}
    </span>
  );
}

function RiskBadge({ level, children }: { level: ShortageRiskLevel; children: React.ReactNode }) {
  return <Badge classes={LEVEL_CLASSES[level]}>{children}</Badge>;
}

/**
 * Une ligne par carburant : prix, déclaration, prévision — de rupture s'il
 * est disponible, de réapprovisionnement s'il est en rupture.
 */
function FuelRow({ fuel, now }: { fuel: FavoriteFuel; now: Date }) {
  const outlook = fuel.shortageOutlook;
  const restock = fuel.restockOutlook;
  return (
    <li className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1 py-2.5 sm:grid-cols-[6rem_8rem_1fr] sm:items-center">
      <span className="font-medium text-foreground">{FUEL_LABELS[fuel.code]}</span>

      <span className="tabular-nums">
        {fuel.available && fuel.price !== null ? (
          <>
            <span className="font-semibold text-foreground">{formatLiterPrice(fuel.price)}</span>
            {fuel.isStale && (
              <span className="ml-1" aria-label="prix ancien, à vérifier" title="Prix ancien, à vérifier">
                ⚠️
              </span>
            )}
            {fuel.updatedAt && (
              <span className="block text-[11px] text-faint">déclaré {timeAgo(fuel.updatedAt)}</span>
            )}
          </>
        ) : (
          <span className="text-danger font-medium">En rupture</span>
        )}
      </span>

      {/* Sur mobile, la prévision passe sous le prix, alignée avec lui. */}
      <span className="col-start-2 text-sm sm:col-start-auto">
        {!fuel.available ? (
          <span className="flex flex-col gap-1">
            <span className="text-muted">
              {fuel.shortageSince
                ? `Rupture déclarée ${timeAgo(fuel.shortageSince)}`
                : 'Rupture déclarée, date inconnue'}
            </span>
            {restock && (
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Badge classes={RESTOCK_CLASSES[restock.level]}>{formatRisk(restock.probability)}</Badge>
                <span className="text-foreground/80">{restockSentence(restock, now)}</span>
              </span>
            )}
          </span>
        ) : outlook ? (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <RiskBadge level={outlook.level}>{formatRisk(outlook.risk)}</RiskBadge>
            <span className="text-foreground/80">{outlookSentence(outlook, now)}</span>
          </span>
        ) : (
          <span className="text-faint">Pas de prévision</span>
        )}
      </span>
    </li>
  );
}

/**
 * Carte d'une station favorite : prix de chaque carburant et prévision à
 * 24 h (rupture ou réapprovisionnement). Composant serveur — seule l'étoile
 * est interactive.
 *
 * Retirer l'étoile ne fait pas disparaître la carte tout de suite : elle reste
 * jusqu'au prochain chargement, ce qui laisse le temps de se raviser.
 */
export function FavoriteStationCard({
  favorite,
  now = new Date(),
}: {
  favorite: FavoriteStationDetails;
  now?: Date;
}) {
  const { station } = favorite;

  if (station === null) {
    return (
      <article className="relative rounded-2xl border border-dashed border-border bg-surface py-4 pl-4 pr-16">
        <p className="font-semibold text-foreground">Station n° {favorite.id}</p>
        <p className="text-sm text-muted mt-1">
          Absente du flux officiel (fermée, ou temporairement non déclarée). Elle reste dans vos
          favorites et réapparaîtra si elle publie de nouveau ses prix.
        </p>
        <div className="absolute right-3 top-3">
          <FavoriteStationButton stationId={favorite.id} initialFavorite />
        </div>
      </article>
    );
  }

  const label = stationLabel(station);
  const worst = worstRiskLevel(station.fuels);

  return (
    <article className="rounded-2xl border border-border bg-surface p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-foreground truncate">
            {label.title}
            {label.detail && <span className="font-normal text-muted"> · {label.detail}</span>}
          </h2>
          <p className="text-sm text-foreground/80 truncate">{station.address || 'Adresse inconnue'}</p>
          <p className="text-xs text-muted">
            {station.postcode} {station.city}
            {station.roadType === 'A' && ' · autoroute'}
          </p>
          {(worst === 'likely' || worst === 'elevated') && (
            <p className="mt-1.5">
              <RiskBadge level={worst}>{RISK_LEVEL_LABELS[worst]}</RiskBadge>
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <a
            href={googleMapsUrl(station)}
            target="_blank"
            rel="noreferrer"
            aria-label={`Ouvrir ${label.title} dans Google Maps`}
            title="Ouvrir dans Google Maps"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
              <circle cx="12" cy="9.5" r="2.5" strokeWidth={2} />
            </svg>
          </a>
          <FavoriteStationButton stationId={favorite.id} initialFavorite />
        </div>
      </header>

      {station.fuels.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Aucun carburant déclaré par cette station.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border-subtle">
          {sortFuels(station.fuels).map((fuel) => (
            <FuelRow key={fuel.code} fuel={fuel} now={now} />
          ))}
        </ul>
      )}
    </article>
  );
}

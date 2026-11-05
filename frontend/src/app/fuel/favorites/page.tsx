import Link from 'next/link';
import { getFavoriteStationDetails } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { formatRisk } from '@/lib/fuel';
import { FavoriteStationCard } from '@/components/FavoriteStationCard';

export const dynamic = 'force-dynamic';

export default async function FavoriteStationsPage() {
  const { stations, forecast } = await getFavoriteStationDetails();
  const now = new Date();

  return (
    <main className="max-w-4xl mx-auto px-4 py-6">
      <Link href="/fuel" className="text-sm text-muted hover:text-foreground mb-4 inline-block">
        ← Carte des carburants
      </Link>
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-foreground">Mes stations</h1>
        <p className="text-sm text-muted mt-1">
          Prix de vos stations favorites et risque de rupture de chaque carburant dans les{' '}
          {forecast.horizonHours} prochaines heures.
        </p>
      </div>

      {stations.length === 0 ? (
        <div className="text-center py-16 bg-surface rounded-2xl border border-dashed border-border">
          <p className="text-4xl mb-3">⛽</p>
          <p className="text-muted font-medium">Aucune station favorite pour l’instant.</p>
          <p className="text-sm text-faint mt-1">
            Sur la carte, cliquez sur l’étoile d’une station pour la suivre ici.
          </p>
          <Link
            href="/fuel"
            className="inline-block mt-5 px-4 py-2 bg-accent text-on-accent text-sm font-semibold rounded-xl hover:bg-accent-hover transition-colors"
          >
            Ouvrir la carte
          </Link>
        </div>
      ) : (
        <>
          <p className="mb-3 text-xs text-faint">
            {forecast.computedAt
              ? `Prévisions calculées ${timeAgo(forecast.computedAt)}, mises à jour toutes les 30 minutes.`
              : 'Aucune prévision disponible pour le moment : le modèle n’est pas en service ou n’a pas été recalculé récemment. Les prix restent à jour.'}
          </p>

          <div className="space-y-3">
            {stations.map((favorite) => (
              <FavoriteStationCard key={favorite.id} favorite={favorite} now={now} />
            ))}
          </div>

          <details className="mt-6 rounded-2xl border border-border bg-surface p-4 text-sm text-muted">
            <summary className="cursor-pointer font-medium text-foreground">
              Comment lire la prévision ?
            </summary>
            <div className="mt-3 space-y-2">
              <p>
                Le pourcentage est la probabilité qu’une rupture de ce carburant commence dans cette
                station <strong>avant l’heure indiquée</strong>, c’est-à-dire dans les{' '}
                {forecast.horizonHours} h qui suivent le calcul. Le modèle ne prédit pas une heure
                précise de rupture : seulement si elle survient ou non dans cette fenêtre.
              </p>
              <p>
                Il apprend sur l’historique officiel des ruptures (ministère de l’Économie) : ruptures
                passées de la station, ancienneté du dernier prix, ruptures en cours dans le
                département et en France, jour et heure.
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <strong>Rupture probable</strong> : {formatRisk(forecast.likelyThreshold)} ou plus —
                  même seuil que l’alerte SMS. Mesuré sur les dernières semaines, un peu plus d’une
                  prévision sur deux à ce niveau est suivie d’une rupture.
                </li>
                <li>
                  <strong>Risque élevé</strong> : de {formatRisk(forecast.elevatedThreshold)} à{' '}
                  {formatRisk(forecast.likelyThreshold)}, soit plusieurs fois la fréquence habituelle
                  (environ 3,5 % par jour). Mieux vaut ne pas attendre la réserve.
                </li>
                <li>
                  <strong>Risque faible</strong> : en dessous.
                </li>
              </ul>
              <p>
                Pas de prévision pour un carburant déjà en rupture (la question ne se pose plus), ni
                quand le modèle n’a pas tourné depuis plus de {forecast.maxAgeHours} h.
              </p>
            </div>
          </details>
        </>
      )}
    </main>
  );
}

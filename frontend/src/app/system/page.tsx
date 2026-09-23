import { ComponentVersionList } from '@/components/ComponentVersionList';
import { RedeployForm } from '@/components/RedeployForm';
import { RolloutRefresher } from '@/components/RolloutRefresher';
import { getUpdateStatus, type UpdateStatus } from '@/lib/api';
import { timeAgo } from '@/lib/format';

export const dynamic = 'force-dynamic';

function Summary({ status }: { status: UpdateStatus }) {
  if (status.rolloutInProgress) {
    return <p className="text-accent font-medium">Mise à jour en cours — les composants redémarrent un par un.</p>;
  }
  if (status.updateAvailable) {
    return <p className="text-warn font-medium">Une nouvelle version est disponible.</p>;
  }
  if (status.components.some((c) => c.status === 'unknown')) {
    return (
      <p className="text-muted font-medium">
        Certaines versions n’ont pas pu être comparées au registre d’images.
      </p>
    );
  }
  return <p className="text-deal font-medium">L’application est à jour.</p>;
}

export default async function SystemPage() {
  let status: UpdateStatus | null = null;
  try {
    status = await getUpdateStatus();
  } catch (error) {
    console.error('SystemPage', error instanceof Error ? error.message : error);
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Système</h1>
        <p className="text-sm text-muted mt-1">
          Versions déployées, comparées aux dernières images publiées par la CI
          {status && <> · vérifié {timeAgo(status.checkedAt)}</>}
        </p>
      </div>

      {status === null ? (
        <section className="bg-surface rounded-2xl border border-border p-5 text-sm text-muted">
          Le backend est injoignable : impossible de connaître l’état des versions.
        </section>
      ) : !status.clusterAvailable ? (
        <section className="bg-surface rounded-2xl border border-border p-5 text-sm text-muted">
          Le backend ne tourne pas dans Kubernetes (développement local) : il n’y a rien à
          mettre à jour depuis l’interface.
        </section>
      ) : (
        <>
          <RolloutRefresher active={status.rolloutInProgress} />

          <section className="bg-surface rounded-2xl border border-border overflow-hidden">
            <div className="px-5 py-4 border-b border-border-subtle">
              <Summary status={status} />
            </div>
            <ComponentVersionList components={status.components} />
          </section>

          <section className="bg-surface rounded-2xl border border-border p-5 space-y-4">
            <div>
              <h2 className="font-semibold text-foreground">Mettre à jour</h2>
              <p className="text-sm text-muted mt-1">
                Redémarre les composants dont l’image a changé : chacun tire la dernière image
                publiée, et l’ancien reste en service tant que le nouveau n’est pas prêt.
              </p>
            </div>

            {status.redeployEnabled ? (
              <RedeployForm
                updateAvailable={status.updateAvailable}
                rolloutInProgress={status.rolloutInProgress}
              />
            ) : (
              <p className="text-sm text-muted">
                Désactivé : définissez <code className="font-mono">ADMIN_TOKEN</code> dans{' '}
                <code className="font-mono">k8s/base/secrets.env</code> puis relancez{' '}
                <code className="font-mono">./k8s/install.sh</code>.
              </p>
            )}

            <ul className="text-xs text-faint space-y-1 list-disc pl-4">
              <li>
                Les changements de configuration Kubernetes (variables, ressources, droits) ne
                sont pas couverts : ils demandent toujours <code className="font-mono">./k8s/install.sh</code>.
              </li>
              <li>
                Évitez de lancer une mise à jour pendant le DAG quotidien (6 h UTC) : redémarrer
                le scheduler Airflow peut interrompre le run en cours.
              </li>
            </ul>
          </section>
        </>
      )}
    </main>
  );
}

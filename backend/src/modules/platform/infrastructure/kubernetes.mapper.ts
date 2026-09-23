import { DeployedComponent } from '../application/ports/cluster.gateway';

/**
 * Sous-ensemble des objets de l'API Kubernetes que l'on lit. Volontairement
 * minimal et tout en optionnel : l'API omet les compteurs à zéro (un
 * `availableReplicas` absent veut dire 0).
 */
export interface KubeDeployment {
  metadata: { name: string; generation?: number };
  spec: {
    replicas?: number;
    selector: { matchLabels?: Record<string, string> };
    template: { spec: { containers: { name: string; image: string }[] } };
  };
  status?: {
    observedGeneration?: number;
    replicas?: number;
    updatedReplicas?: number;
    availableReplicas?: number;
  };
}

export interface KubePod {
  metadata: { deletionTimestamp?: string };
  status?: { containerStatuses?: { name: string; imageID?: string }[] };
}

/** `app=x,tier=y` — format attendu par le paramètre `labelSelector`. */
export function labelSelectorOf(deployment: KubeDeployment): string {
  return Object.entries(deployment.spec.selector.matchLabels ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join(',');
}

/**
 * Même critère que `kubectl rollout status` : le rollout est terminé quand le
 * contrôleur a vu la dernière spec, que tous les Pods voulus sont à la
 * nouvelle version, qu'aucun ancien Pod ne subsiste et qu'ils sont tous
 * disponibles.
 */
export function isRolloutInProgress(deployment: KubeDeployment): boolean {
  const desired = deployment.spec.replicas ?? 1;
  const status = deployment.status ?? {};
  const updated = status.updatedReplicas ?? 0;

  if ((deployment.metadata.generation ?? 0) > (status.observedGeneration ?? 0)) return true;
  if (updated < desired) return true;
  if ((status.replicas ?? 0) > updated) return true;
  return (status.availableReplicas ?? 0) < updated;
}

/**
 * Extrait le digest d'un `imageID` de conteneur.
 *
 * Le runtime le publie sous la forme `<dépôt>@sha256:…` (containerd) ou
 * `docker-pullable://<dépôt>@sha256:…` (Docker) : c'est le digest du manifeste
 * tiré depuis le registre, donc comparable à ce que le registre annonce. Un
 * `sha256:…` nu est l'identifiant local de l'image, sans rapport avec le
 * registre : on ne peut rien en conclure.
 */
export function digestOf(imageID: string | undefined): string | null {
  if (!imageID) return null;
  const at = imageID.lastIndexOf('@');
  if (at === -1) return null;
  const digest = imageID.slice(at + 1);
  return /^sha256:[0-9a-f]{64}$/.test(digest) ? digest : null;
}

export function toDeployedComponent(
  deployment: KubeDeployment,
  pods: readonly KubePod[],
): DeployedComponent {
  const container = deployment.spec.template.spec.containers[0];

  // Les Pods en cours d'arrêt tournent encore l'ancienne image : on les ignore.
  const digests = new Set(
    pods
      .filter((pod) => !pod.metadata.deletionTimestamp)
      .map((pod) =>
        digestOf(pod.status?.containerStatuses?.find((c) => c.name === container.name)?.imageID),
      ),
  );
  const [only] = digests;

  return {
    name: deployment.metadata.name,
    image: container.image,
    runningDigest: digests.size === 1 ? only : null,
    rolloutInProgress: isRolloutInProgress(deployment),
  };
}

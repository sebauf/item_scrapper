/** Un Deployment de l'application, tel que le cluster le voit. */
export interface DeployedComponent {
  name: string;
  image: string;
  /** Digest commun aux Pods en service ; `null` s'ils divergent ou n'en exposent pas. */
  runningDigest: string | null;
  rolloutInProgress: boolean;
}

/**
 * Port vers l'orchestrateur. Seule implémentation : l'API Kubernetes (cf.
 * KubernetesClusterGateway). En développement local il n'y a pas de cluster,
 * d'où `isAvailable()` plutôt qu'une erreur au démarrage.
 */
export abstract class ClusterGateway {
  abstract isAvailable(): boolean;

  abstract listComponents(): Promise<DeployedComponent[]>;

  /** Relance les Pods des Deployments nommés — l'équivalent de `kubectl rollout restart`. */
  abstract restart(names: readonly string[]): Promise<void>;
}

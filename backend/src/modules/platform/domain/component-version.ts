export const COMPONENT_STATUSES = ['up-to-date', 'outdated', 'unknown', 'updating'] as const;
export type ComponentStatus = (typeof COMPONENT_STATUSES)[number];

/**
 * Version d'un composant déployé (backend, frontend, MCP, Airflow…), vue comme
 * la comparaison de deux empreintes d'image.
 *
 * Un tag comme `main` est mobile : la CI le réécrit à chaque build. Seul le
 * digest (`sha256:…`, l'empreinte du contenu) dit si deux images sont les
 * mêmes. On compare donc le digest de l'image *qui tourne* dans les Pods à
 * celui vers lequel le tag pointe *aujourd'hui* dans le registre.
 */
export class ComponentVersion {
  constructor(
    readonly name: string,
    /** Référence telle que déclarée dans le Deployment, ex. `ghcr.io/o/r:main`. */
    readonly image: string,
    /** `null` quand les Pods ne s'accordent pas (rollout) ou n'exposent rien. */
    readonly runningDigest: string | null,
    /** `null` quand le registre n'a pas pu être interrogé. */
    readonly latestDigest: string | null,
    readonly rolloutInProgress: boolean,
  ) {}

  get status(): ComponentStatus {
    // Pendant un rollout, anciens et nouveaux Pods coexistent : la comparaison
    // n'aurait pas de sens, et c'est de toute façon l'information utile.
    if (this.rolloutInProgress) return 'updating';
    if (this.runningDigest === null || this.latestDigest === null) return 'unknown';
    return this.runningDigest === this.latestDigest ? 'up-to-date' : 'outdated';
  }
}

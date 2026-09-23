import { ClusterGateway, DeployedComponent } from '../application/ports/cluster.gateway';
import { ImageRegistry } from '../application/ports/image-registry';

export function aDeployedComponent(overrides: Partial<DeployedComponent> = {}): DeployedComponent {
  return {
    name: 'price-tracker-backend',
    image: 'ghcr.io/owner/item_scrapper-backend:main',
    runningDigest: 'sha256:old',
    rolloutInProgress: false,
    ...overrides,
  };
}

/** Cluster en mémoire : expose des composants figés et enregistre les redémarrages. */
export class FakeClusterGateway extends ClusterGateway {
  readonly restarted: string[][] = [];

  constructor(
    private readonly components: DeployedComponent[] = [],
    private readonly available = true,
  ) {
    super();
  }

  isAvailable(): boolean {
    return this.available;
  }

  listComponents(): Promise<DeployedComponent[]> {
    return Promise.resolve(this.components);
  }

  restart(names: readonly string[]): Promise<void> {
    this.restarted.push([...names]);
    return Promise.resolve();
  }
}

/** Registre en mémoire : image → digest ; une image absente vaut `null` (injoignable). */
export class FakeImageRegistry extends ImageRegistry {
  readonly lookups: string[] = [];

  constructor(private readonly digests: Record<string, string> = {}) {
    super();
  }

  latestDigest(image: string): Promise<string | null> {
    this.lookups.push(image);
    return Promise.resolve(this.digests[image] ?? null);
  }
}

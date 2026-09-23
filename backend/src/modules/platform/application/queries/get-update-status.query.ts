import { Injectable } from '@nestjs/common';
import { ComponentVersion } from '../../domain/component-version';
import { RedeployPolicy } from '../../domain/redeploy-policy';
import { ClusterGateway } from '../ports/cluster.gateway';
import { ImageRegistry } from '../ports/image-registry';

export interface UpdateStatus {
  clusterAvailable: boolean;
  updateAvailable: boolean;
  rolloutInProgress: boolean;
  components: ComponentVersion[];
  checkedAt: Date;
}

/**
 * État de mise à jour de chaque composant : ce qui tourne comparé à ce que le
 * registre propose.
 */
@Injectable()
export class GetUpdateStatusQuery {
  constructor(
    private readonly cluster: ClusterGateway,
    private readonly registry: ImageRegistry,
  ) {}

  async execute(): Promise<UpdateStatus> {
    if (!this.cluster.isAvailable()) {
      return {
        clusterAvailable: false,
        updateAvailable: false,
        rolloutInProgress: false,
        components: [],
        checkedAt: new Date(),
      };
    }

    const deployed = await this.cluster.listComponents();

    // airflow-webserver et airflow-scheduler partagent la même image : une
    // seule interrogation du registre par référence.
    const lookups = new Map<string, Promise<string | null>>();
    for (const { image } of deployed) {
      if (!lookups.has(image)) lookups.set(image, this.registry.latestDigest(image));
    }

    const components = await Promise.all(
      deployed.map(
        async (component) =>
          new ComponentVersion(
            component.name,
            component.image,
            component.runningDigest,
            await lookups.get(component.image)!,
            component.rolloutInProgress,
          ),
      ),
    );

    return {
      clusterAvailable: true,
      updateAvailable: RedeployPolicy.isUpdateAvailable(components),
      rolloutInProgress: RedeployPolicy.isRolloutInProgress(components),
      components,
      checkedAt: new Date(),
    };
  }
}

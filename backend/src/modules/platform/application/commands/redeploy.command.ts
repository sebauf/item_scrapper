import { Injectable } from '@nestjs/common';
import { ClusterUnavailable } from '../../domain/platform.errors';
import { RedeployPolicy } from '../../domain/redeploy-policy';
import { ClusterGateway } from '../ports/cluster.gateway';
import { GetUpdateStatusQuery } from '../queries/get-update-status.query';

/**
 * Met l'application à jour : redémarre les composants que la politique
 * désigne. Les Deployments étant en `imagePullPolicy: Always`, chaque nouveau
 * Pod tire la dernière image du tag.
 *
 * Le backend peut figurer parmi les composants redémarrés — il se redémarre
 * donc lui-même. Ce n'est pas un problème : le rolling update démarre le
 * nouveau Pod et attend qu'il soit prêt avant d'arrêter l'ancien, bien après
 * que cette requête a répondu.
 */
@Injectable()
export class RedeployCommand {
  constructor(
    private readonly cluster: ClusterGateway,
    private readonly status: GetUpdateStatusQuery,
  ) {}

  async execute(): Promise<string[]> {
    if (!this.cluster.isAvailable()) throw new ClusterUnavailable();

    const { components } = await this.status.execute();
    const targets = RedeployPolicy.select(components);

    await this.cluster.restart(targets);
    return targets;
  }
}

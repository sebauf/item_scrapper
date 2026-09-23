import { AlreadyUpToDate, ClusterUnavailable, RolloutInProgress } from '../../domain/platform.errors';
import { aDeployedComponent, FakeClusterGateway, FakeImageRegistry } from '../../testing/fakes';
import { GetUpdateStatusQuery } from '../queries/get-update-status.query';
import { RedeployCommand } from './redeploy.command';

describe('RedeployCommand', () => {
  const image = 'ghcr.io/owner/item_scrapper-backend:main';

  function commandFor(cluster: FakeClusterGateway, registry = new FakeImageRegistry()) {
    return new RedeployCommand(cluster, new GetUpdateStatusQuery(cluster, registry));
  }

  it('redémarre les seuls composants en retard', async () => {
    const cluster = new FakeClusterGateway([
      aDeployedComponent({ name: 'backend', image, runningDigest: 'sha256:old' }),
      aDeployedComponent({ name: 'frontend', image: 'front:main', runningDigest: 'sha256:f' }),
    ]);
    const registry = new FakeImageRegistry({ [image]: 'sha256:new', 'front:main': 'sha256:f' });

    await expect(commandFor(cluster, registry).execute()).resolves.toEqual(['backend']);
    expect(cluster.restarted).toEqual([['backend']]);
  });

  it('refuse hors cluster', async () => {
    const cluster = new FakeClusterGateway([aDeployedComponent()], false);

    await expect(commandFor(cluster).execute()).rejects.toThrow(ClusterUnavailable);
    expect(cluster.restarted).toEqual([]);
  });

  it('refuse quand tout est à jour, sans rien redémarrer', async () => {
    const cluster = new FakeClusterGateway([aDeployedComponent({ image, runningDigest: 'sha256:x' })]);
    const registry = new FakeImageRegistry({ [image]: 'sha256:x' });

    await expect(commandFor(cluster, registry).execute()).rejects.toThrow(AlreadyUpToDate);
    expect(cluster.restarted).toEqual([]);
  });

  it('refuse pendant un rollout, sans rien redémarrer', async () => {
    const cluster = new FakeClusterGateway([aDeployedComponent({ rolloutInProgress: true })]);

    await expect(commandFor(cluster).execute()).rejects.toThrow(RolloutInProgress);
    expect(cluster.restarted).toEqual([]);
  });
});

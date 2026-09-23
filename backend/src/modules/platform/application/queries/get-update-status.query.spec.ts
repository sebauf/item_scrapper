import { aDeployedComponent, FakeClusterGateway, FakeImageRegistry } from '../../testing/fakes';
import { GetUpdateStatusQuery } from './get-update-status.query';

describe('GetUpdateStatusQuery', () => {
  const backendImage = 'ghcr.io/owner/item_scrapper-backend:main';
  const airflowImage = 'ghcr.io/owner/item_scrapper-airflow:main';

  it('compare ce qui tourne au registre, composant par composant', async () => {
    const cluster = new FakeClusterGateway([
      aDeployedComponent({ name: 'backend', image: backendImage, runningDigest: 'sha256:old' }),
      aDeployedComponent({ name: 'airflow', image: airflowImage, runningDigest: 'sha256:air' }),
    ]);
    const registry = new FakeImageRegistry({
      [backendImage]: 'sha256:new',
      [airflowImage]: 'sha256:air',
    });

    const status = await new GetUpdateStatusQuery(cluster, registry).execute();

    expect(status.clusterAvailable).toBe(true);
    expect(status.updateAvailable).toBe(true);
    expect(status.rolloutInProgress).toBe(false);
    expect(status.components.map((c) => [c.name, c.status])).toEqual([
      ['backend', 'outdated'],
      ['airflow', 'up-to-date'],
    ]);
  });

  it('n’interroge le registre qu’une fois par image partagée', async () => {
    const cluster = new FakeClusterGateway([
      aDeployedComponent({ name: 'airflow-webserver', image: airflowImage }),
      aDeployedComponent({ name: 'airflow-scheduler', image: airflowImage }),
    ]);
    const registry = new FakeImageRegistry();

    await new GetUpdateStatusQuery(cluster, registry).execute();

    expect(registry.lookups).toEqual([airflowImage]);
  });

  it('signale un rollout en cours', async () => {
    const cluster = new FakeClusterGateway([aDeployedComponent({ rolloutInProgress: true })]);

    const status = await new GetUpdateStatusQuery(cluster, new FakeImageRegistry()).execute();

    expect(status.rolloutInProgress).toBe(true);
    expect(status.components[0].status).toBe('updating');
  });

  it('renvoie un état vide hors cluster, sans interroger quoi que ce soit', async () => {
    const registry = new FakeImageRegistry();
    const cluster = new FakeClusterGateway([aDeployedComponent()], false);

    const status = await new GetUpdateStatusQuery(cluster, registry).execute();

    expect(status).toMatchObject({ clusterAvailable: false, updateAvailable: false, components: [] });
    expect(registry.lookups).toEqual([]);
  });
});

import {
  digestOf,
  isRolloutInProgress,
  KubeDeployment,
  KubePod,
  labelSelectorOf,
  toDeployedComponent,
} from './kubernetes.mapper';

const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;

function aDeployment(overrides: { status?: KubeDeployment['status']; generation?: number } = {}): KubeDeployment {
  return {
    metadata: { name: 'price-tracker-backend', generation: overrides.generation ?? 3 },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: 'price-tracker-backend' } },
      template: {
        spec: { containers: [{ name: 'backend', image: 'ghcr.io/o/item_scrapper-backend:main' }] },
      },
    },
    status: overrides.status ?? {
      observedGeneration: 3,
      replicas: 1,
      updatedReplicas: 1,
      availableReplicas: 1,
    },
  };
}

function aPod(imageID: string, terminating = false): KubePod {
  return {
    metadata: terminating ? { deletionTimestamp: '2026-09-23T10:00:00Z' } : {},
    status: { containerStatuses: [{ name: 'backend', imageID }] },
  };
}

describe('mapper Kubernetes', () => {
  describe('digestOf', () => {
    it.each([
      ['containerd', `ghcr.io/o/r@${DIGEST_A}`],
      ['Docker', `docker-pullable://ghcr.io/o/r@${DIGEST_A}`],
    ])('lit le digest publié par %s', (_runtime, imageID) => {
      expect(digestOf(imageID)).toBe(DIGEST_A);
    });

    it.each([
      ['absent', undefined],
      ['vide', ''],
      ["un identifiant local d'image", DIGEST_A],
      ['un digest tronqué', 'ghcr.io/o/r@sha256:abc'],
    ])('renvoie null pour %s', (_label, imageID) => {
      expect(digestOf(imageID)).toBeNull();
    });
  });

  describe('isRolloutInProgress', () => {
    it('est faux sur un Deployment stable', () => {
      expect(isRolloutInProgress(aDeployment())).toBe(false);
    });

    it.each([
      ['la nouvelle spec n’a pas encore été vue', { generation: 4 }],
      [
        'le nouveau Pod n’est pas encore créé',
        { status: { observedGeneration: 3, replicas: 1, updatedReplicas: 0, availableReplicas: 1 } },
      ],
      [
        'l’ancien Pod est encore là',
        { status: { observedGeneration: 3, replicas: 2, updatedReplicas: 1, availableReplicas: 1 } },
      ],
      [
        'le nouveau Pod n’est pas encore prêt',
        { status: { observedGeneration: 3, replicas: 1, updatedReplicas: 1 } },
      ],
    ])('est vrai quand %s', (_label, overrides) => {
      expect(isRolloutInProgress(aDeployment(overrides))).toBe(true);
    });
  });

  it('construit le sélecteur de labels', () => {
    expect(labelSelectorOf(aDeployment())).toBe('app=price-tracker-backend');
  });

  describe('toDeployedComponent', () => {
    it('reprend le nom, l’image déclarée et le digest des Pods', () => {
      expect(toDeployedComponent(aDeployment(), [aPod(`r@${DIGEST_A}`)])).toEqual({
        name: 'price-tracker-backend',
        image: 'ghcr.io/o/item_scrapper-backend:main',
        runningDigest: DIGEST_A,
        rolloutInProgress: false,
      });
    });

    it('ignore les Pods en cours d’arrêt', () => {
      const pods = [aPod(`r@${DIGEST_A}`), aPod(`r@${DIGEST_B}`, true)];

      expect(toDeployedComponent(aDeployment(), pods).runningDigest).toBe(DIGEST_A);
    });

    it('renvoie null quand les Pods ne tournent pas la même image', () => {
      const pods = [aPod(`r@${DIGEST_A}`), aPod(`r@${DIGEST_B}`)];

      expect(toDeployedComponent(aDeployment(), pods).runningDigest).toBeNull();
    });

    it('renvoie null sans Pod', () => {
      expect(toDeployedComponent(aDeployment(), []).runningDigest).toBeNull();
    });
  });
});

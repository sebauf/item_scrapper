import { ComponentVersion } from './component-version';
import { AlreadyUpToDate, RolloutInProgress } from './platform.errors';
import { RedeployPolicy } from './redeploy-policy';

describe('RedeployPolicy', () => {
  const upToDate = (name: string) => new ComponentVersion(name, 'img', 'sha256:a', 'sha256:a', false);
  const outdated = (name: string) => new ComponentVersion(name, 'img', 'sha256:a', 'sha256:b', false);
  const unknown = (name: string) => new ComponentVersion(name, 'img', 'sha256:a', null, false);
  const updating = (name: string) => new ComponentVersion(name, 'img', null, 'sha256:b', true);

  describe('isUpdateAvailable', () => {
    it('signale une mise à jour dès qu’un composant est en retard', () => {
      expect(RedeployPolicy.isUpdateAvailable([upToDate('a'), outdated('b')])).toBe(true);
    });

    it('ne signale rien sur un état inconnu : l’indicateur ne doit pas mentir', () => {
      expect(RedeployPolicy.isUpdateAvailable([upToDate('a'), unknown('b')])).toBe(false);
    });
  });

  describe('select', () => {
    it('retient les composants en retard et ceux dont l’état est inconnu', () => {
      expect(RedeployPolicy.select([upToDate('a'), outdated('b'), unknown('c')])).toEqual(['b', 'c']);
    });

    it('refuse pendant un rollout', () => {
      expect(() => RedeployPolicy.select([outdated('a'), updating('b')])).toThrow(RolloutInProgress);
    });

    it('refuse quand tout est déjà à jour', () => {
      expect(() => RedeployPolicy.select([upToDate('a'), upToDate('b')])).toThrow(AlreadyUpToDate);
    });

    it('refuse quand il n’y a aucun composant', () => {
      expect(() => RedeployPolicy.select([])).toThrow(AlreadyUpToDate);
    });
  });
});

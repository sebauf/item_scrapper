import { ComponentVersion } from './component-version';

describe('ComponentVersion', () => {
  const version = (
    running: string | null,
    latest: string | null,
    rolloutInProgress = false,
  ): ComponentVersion =>
    new ComponentVersion('backend', 'ghcr.io/o/r:main', running, latest, rolloutInProgress);

  it('est à jour quand les deux digests coïncident', () => {
    expect(version('sha256:a', 'sha256:a').status).toBe('up-to-date');
  });

  it('est en retard quand le registre pointe ailleurs', () => {
    expect(version('sha256:a', 'sha256:b').status).toBe('outdated');
  });

  it.each([
    ['le digest en cours', null, 'sha256:b'],
    ['le digest du registre', 'sha256:a', null],
  ])('est inconnu quand %s manque', (_label, running, latest) => {
    expect(version(running, latest).status).toBe('unknown');
  });

  it('est en cours de mise à jour pendant un rollout, quels que soient les digests', () => {
    expect(version('sha256:a', 'sha256:a', true).status).toBe('updating');
    expect(version(null, null, true).status).toBe('updating');
  });
});

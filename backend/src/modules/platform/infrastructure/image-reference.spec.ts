import { ImageReference } from './image-reference';

describe('ImageReference', () => {
  it.each([
    ['ghcr.io/owner/item_scrapper-backend:main', 'ghcr.io', 'owner/item_scrapper-backend', 'main'],
    ['ghcr.io/owner/repo', 'ghcr.io', 'owner/repo', 'latest'],
    ['localhost:5000/repo:dev', 'localhost:5000', 'repo', 'dev'],
    ['registry.example:5000/a/b:1.2.3', 'registry.example:5000', 'a/b', '1.2.3'],
    ['mongo:7', 'docker.io', 'library/mongo', '7'],
    ['bitnami/redis', 'docker.io', 'bitnami/redis', 'latest'],
  ])('décompose %s', (raw, registry, repository, tag) => {
    const ref = ImageReference.parse(raw);

    expect([ref.registry, ref.repository, ref.tag, ref.digest]).toEqual([registry, repository, tag, null]);
  });

  it('garde le digest d’une image épinglée', () => {
    const digest = `sha256:${'a'.repeat(64)}`;

    expect(ImageReference.parse(`ghcr.io/o/r:main@${digest}`).digest).toBe(digest);
  });

  it('adresse l’API de Docker Hub sur son hôte réel', () => {
    expect(ImageReference.parse('mongo:7').apiHost).toBe('registry-1.docker.io');
    expect(ImageReference.parse('ghcr.io/o/r:main').apiHost).toBe('ghcr.io');
  });

  it.each(['ghcr.io/o/r:', 'ghcr.io//r:main'])('refuse %s', (raw) => {
    expect(() => ImageReference.parse(raw)).toThrow(/invalide/);
  });
});

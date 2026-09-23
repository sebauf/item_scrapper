/**
 * Référence d'image décomposée : `ghcr.io/owner/repo:tag` →
 * registre `ghcr.io`, dépôt `owner/repo`, tag `tag`.
 *
 * Suit les conventions de Docker : sans hôte explicite (premier segment sans
 * `.` ni `:`), le registre est Docker Hub et un dépôt à un seul segment est
 * préfixé par `library/` (`mongo:7` → `docker.io/library/mongo:7`).
 */
export class ImageReference {
  private constructor(
    readonly registry: string,
    readonly repository: string,
    readonly tag: string,
    readonly digest: string | null,
  ) {}

  static parse(raw: string): ImageReference {
    let rest = raw.trim();
    let digest: string | null = null;

    const at = rest.indexOf('@');
    if (at !== -1) {
      digest = rest.slice(at + 1);
      rest = rest.slice(0, at);
    }

    let tag = 'latest';
    const colon = rest.lastIndexOf(':');
    if (colon > rest.lastIndexOf('/')) {
      tag = rest.slice(colon + 1);
      rest = rest.slice(0, colon);
    }

    const segments = rest.split('/');
    const hasHost =
      segments.length > 1 && (/[.:]/.test(segments[0]) || segments[0] === 'localhost');
    const registry = hasHost ? segments.shift()! : 'docker.io';
    if (!hasHost && segments.length === 1) segments.unshift('library');

    if (!tag || segments.some((segment) => !segment)) {
      throw new Error(`Référence d'image invalide : « ${raw} »`);
    }
    return new ImageReference(registry, segments.join('/'), tag, digest);
  }

  /** Hôte de l'API du registre — Docker Hub ne la sert pas sur docker.io. */
  get apiHost(): string {
    return this.registry === 'docker.io' ? 'registry-1.docker.io' : this.registry;
  }
}

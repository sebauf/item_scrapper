import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppConfig } from 'src/config/app-config';
import { OciImageRegistry, parseChallenge } from './oci-image.registry';

/**
 * `fetch` est bouchonné : on vérifie le dialogue avec le registre (HEAD,
 * défi 401, jeton, nouvel essai) et, surtout, qu'aucune panne ne remonte en
 * exception — un registre injoignable doit donner un état « inconnu ».
 */
describe('OciImageRegistry', () => {
  const image = 'ghcr.io/owner/item_scrapper-backend:main';
  const manifestUrl = 'https://ghcr.io/v2/owner/item_scrapper-backend/manifests/main';
  const digest = `sha256:${'d'.repeat(64)}`;

  function registryWith(authFile = '/inexistant/.dockerconfigjson'): OciImageRegistry {
    const config = AppConfig.fromEnv({
      MONGODB_URI: 'mongodb://localhost',
      REGISTRY_AUTH_FILE: authFile,
    });
    return new OciImageRegistry(config);
  }

  function reply(status: number, headers: Record<string, string> = {}, body?: unknown): Response {
    return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
  }

  let fetchMock: jest.SpyInstance;
  afterEach(() => fetchMock.mockRestore());

  function mockFetch(...responses: Response[]) {
    fetchMock = jest.spyOn(global, 'fetch');
    for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  }

  it('lit le digest dans l’en-tête du manifeste', async () => {
    mockFetch(reply(200, { 'docker-content-digest': digest }));

    await expect(registryWith().latestDigest(image)).resolves.toBe(digest);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(manifestUrl);
    expect(init.method).toBe('HEAD');
    // L'index d'abord : c'est son digest que le runtime enregistre au pull.
    expect((init.headers as Record<string, string>).accept).toMatch(/^application\/vnd\.oci\.image\.index/);
  });

  it('suit le défi 401 : demande un jeton puis réessaie', async () => {
    mockFetch(
      reply(401, {
        'www-authenticate':
          'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:owner/item_scrapper-backend:pull"',
      }),
      reply(200, {}, { token: 'jeton-anonyme' }),
      reply(200, { 'docker-content-digest': digest }),
    );

    await expect(registryWith().latestDigest(image)).resolves.toBe(digest);

    const tokenUrl = new URL(String(fetchMock.mock.calls[1][0]));
    expect(tokenUrl.origin + tokenUrl.pathname).toBe('https://ghcr.io/token');
    expect(tokenUrl.searchParams.get('scope')).toBe('repository:owner/item_scrapper-backend:pull');
    const retry = fetchMock.mock.calls[2][1] as RequestInit;
    expect((retry.headers as Record<string, string>).authorization).toBe('Bearer jeton-anonyme');
  });

  it('présente les identifiants du pull secret pour obtenir le jeton', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'registry-'));
    const authFile = join(dir, '.dockerconfigjson');
    writeFileSync(authFile, JSON.stringify({ auths: { 'ghcr.io': { username: 'me', password: 'pat' } } }));
    mockFetch(
      reply(401, { 'www-authenticate': 'Bearer realm="https://ghcr.io/token",service="ghcr.io"' }),
      reply(200, {}, { token: 'jeton-prive' }),
      reply(200, { 'docker-content-digest': digest }),
    );

    await registryWith(authFile).latestDigest(image);

    const tokenRequest = fetchMock.mock.calls[1][1] as RequestInit;
    expect((tokenRequest.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from('me:pat').toString('base64')}`,
    );
  });

  it('garde le résultat en cache', async () => {
    mockFetch(reply(200, { 'docker-content-digest': digest }));
    const registry = registryWith();

    await registry.latestDigest(image);
    await registry.latestDigest(image);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('renvoie le digest d’une image épinglée sans interroger le registre', async () => {
    mockFetch();

    await expect(registryWith().latestDigest(`ghcr.io/o/r@${digest}`)).resolves.toBe(digest);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['un tag introuvable', () => mockFetch(reply(404))],
    ['un 401 sans défi', () => mockFetch(reply(401))],
    ['un jeton refusé', () => mockFetch(reply(401, { 'www-authenticate': 'Bearer realm="https://ghcr.io/token"' }), reply(403))],
    ['une réponse sans digest', () => mockFetch(reply(200))],
    [
      'une panne réseau',
      () => {
        fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
      },
    ],
  ])('renvoie null, sans lever, sur %s', async (_label, arrange) => {
    arrange();

    await expect(registryWith().latestDigest(image)).resolves.toBeNull();
  });

  it('décompose un défi Bearer', () => {
    expect(parseChallenge('Bearer realm="https://r/token",service="r",scope="repository:a/b:pull"')).toEqual({
      realm: 'https://r/token',
      service: 'r',
      scope: 'repository:a/b:pull',
    });
  });
});

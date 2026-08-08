import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BackendClient, BackendError, buildQueryString } from './client.js';

/** `fetch` de test : mémorise l'URL appelée et renvoie la réponse fournie. */
function stubFetch(response: Response): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function client(fetchImpl: typeof fetch): BackendClient {
  return new BackendClient({ baseUrl: 'http://backend', timeoutMs: 1000, fetchImpl });
}

describe('buildQueryString', () => {
  it('n\'envoie que les filtres renseignés', () => {
    assert.equal(buildQueryString({}), '');
  });

  // Le backend refuse tout paramètre inconnu et attend « deals=1 », pas
  // « dealsOnly=true » : la traduction se fait ici, une seule fois.
  it('traduit dealsOnly en deals=1', () => {
    assert.equal(buildQueryString({ dealsOnly: true }), '?deals=1');
    assert.equal(buildQueryString({ dealsOnly: false }), '');
  });

  it('omet la page 1, qui est le défaut du backend', () => {
    assert.equal(buildQueryString({ page: 1 }), '');
    assert.equal(buildQueryString({ page: 3 }), '?page=3');
  });

  it('sérialise les bornes de prix et le tri', () => {
    assert.equal(
      buildQueryString({ minPrice: 5, maxPrice: 50, sort: 'price_asc' }),
      '?min=5&max=50&sort=price_asc',
    );
  });

  it('échappe la recherche plein texte', () => {
    assert.equal(buildQueryString({ q: 'lessive & co' }), '?q=lessive+%26+co');
  });
});

describe('BackendClient', () => {
  it('préfixe les routes par /api/v1', async () => {
    const { fetchImpl, calls } = stubFetch(new Response('[]', { status: 200 }));

    await client(fetchImpl).listKeywords();

    assert.deepEqual(calls, ['http://backend/api/v1/keywords']);
  });

  it('échappe le mot-clé dans le chemin', async () => {
    const { fetchImpl, calls } = stubFetch(
      new Response(
        JSON.stringify({ items: [], total: 0, pageCount: 0, keywordTotal: 0, keywordDealCount: 0 }),
        { status: 200 },
      ),
    );

    await client(fetchImpl).searchProducts('lessive liquide', { dealsOnly: true });

    assert.deepEqual(calls, ['http://backend/api/v1/keywords/lessive%20liquide/products?deals=1']);
  });

  // POST /keywords répond 201 sans corps : parser du JSON sur une chaîne vide
  // ferait échouer un appel pourtant réussi.
  it('accepte une réponse de succès sans corps', async () => {
    const { fetchImpl } = stubFetch(new Response('', { status: 201 }));

    await client(fetchImpl).trackKeyword('café en grains');
  });

  it('transforme une erreur métier en BackendError typée', async () => {
    const { fetchImpl } = stubFetch(
      new Response(JSON.stringify({ code: 'KEYWORD_ALREADY_TRACKED', message: 'Déjà suivi' }), {
        status: 409,
      }),
    );

    await assert.rejects(client(fetchImpl).trackKeyword('lessive liquide'), (error: unknown) => {
      assert.ok(error instanceof BackendError);
      assert.equal(error.status, 409);
      assert.equal(error.code, 'KEYWORD_ALREADY_TRACKED');
      assert.equal(error.message, 'Déjà suivi');
      return true;
    });
  });

  it('garde le statut quand la réponse d\'erreur n\'est pas du JSON', async () => {
    const { fetchImpl } = stubFetch(new Response('<html>502</html>', { status: 502 }));

    await assert.rejects(client(fetchImpl).getDashboard(), (error: unknown) => {
      assert.ok(error instanceof BackendError);
      assert.equal(error.status, 502);
      assert.equal(error.code, null);
      return true;
    });
  });

  it('convertit un backend injoignable en erreur lisible', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    await assert.rejects(client(fetchImpl).getDashboard(), (error: unknown) => {
      assert.ok(error instanceof BackendError);
      assert.equal(error.code, 'BACKEND_UNREACHABLE');
      return true;
    });
  });

  it('signale un dépassement de délai', async () => {
    const fetchImpl = (async () => {
      const error = new Error('timed out');
      error.name = 'TimeoutError';
      throw error;
    }) as unknown as typeof fetch;

    await assert.rejects(client(fetchImpl).getDashboard(), (error: unknown) => {
      assert.ok(error instanceof BackendError);
      assert.equal(error.status, 504);
      return true;
    });
  });

  it('rend le backend indisponible sans lever, pour la sonde ready', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    assert.equal(await client(fetchImpl).isBackendReady(), false);
  });

  it('interroge /health/ready hors du préfixe de version', async () => {
    const { fetchImpl, calls } = stubFetch(new Response('{}', { status: 200 }));

    assert.equal(await client(fetchImpl).isBackendReady(), true);
    assert.deepEqual(calls, ['http://backend/health/ready']);
  });
});

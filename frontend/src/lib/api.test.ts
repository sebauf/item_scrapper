import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addFavorite,
  ApiError,
  getDashboard,
  getFavorites,
  getKeywords,
  getProduct,
  getTrackedUrls,
  getUpdateStatus,
  isFavorite,
  redeploy,
  removeFavorite,
  searchProducts,
  trackKeyword,
  trackProductUrl,
  untrackKeyword,
  untrackProductUrl,
} from './api';

/**
 * Seul point d'accès aux données du frontend. `fetch` est bouchonné : ce qu'on
 * teste, c'est l'URL appelée, la méthode, et surtout la traduction des réponses
 * — un 404 mal interprété affiche une erreur là où une page « produit
 * inconnu » était attendue.
 *
 * `BACKEND_URL` est figé par vitest.config.ts.
 */
const API = 'http://backend.test/api/v1';

/** Réponse minimale : seul ce que `request()` lit est bouchonné. */
interface FakeResponse {
  ok?: boolean;
  status?: number;
  body?: string;
}

function mockFetch(response: FakeResponse) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    text: () => Promise.resolve(response.body ?? ''),
    json: () =>
      response.body ? Promise.resolve(JSON.parse(response.body)) : Promise.reject(new Error('no body')),
  } as unknown as Response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function jsonResponse(payload: unknown) {
  return mockFetch({ body: JSON.stringify(payload) });
}

function errorResponse(status: number, body?: unknown) {
  return mockFetch({
    ok: false,
    status,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('lectures', () => {
  it('appelle le tableau de bord', async () => {
    const fetchMock = jsonResponse({ keywordCount: 2 });

    await expect(getDashboard()).resolves.toEqual({ keywordCount: 2 });
    expect(fetchMock).toHaveBeenCalledWith(`${API}/dashboard`, { cache: 'no-store' });
  });

  it('ne met jamais les réponses en cache', async () => {
    // Les données ne bougent qu'après le DAG Airflow, mais activer le cache est
    // un changement de comportement à décider, pas à subir.
    const fetchMock = jsonResponse([]);

    await getKeywords();

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store' });
  });

  it('encode le mot-clé dans le chemin', async () => {
    const fetchMock = jsonResponse({ items: [] });

    await searchProducts('lessive liquide', '?sort=price_asc');

    expect(fetchMock).toHaveBeenCalledWith(
      `${API}/keywords/lessive%20liquide/products?sort=price_asc`,
      expect.anything(),
    );
  });

  it('accepte une recherche sans query string', async () => {
    const fetchMock = jsonResponse({ items: [] });

    await searchProducts('lessive', '');

    expect(fetchMock).toHaveBeenCalledWith(`${API}/keywords/lessive/products`, expect.anything());
  });

  it('liste les URLs suivies et les favoris', async () => {
    const fetchMock = jsonResponse([]);

    await getTrackedUrls();
    await getFavorites();

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      `${API}/product-urls`,
      `${API}/favorites`,
    ]);
  });

  it('déplie la réponse du statut favori', async () => {
    jsonResponse({ isFavorite: true });

    await expect(isFavorite('abc')).resolves.toBe(true);
  });
});

describe('écritures', () => {
  it('suit un mot-clé', async () => {
    const fetchMock = mockFetch({ status: 201 });

    await expect(trackKeyword('lessive')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(`${API}/keywords`, {
      cache: 'no-store',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keyword: 'lessive' }),
    });
  });

  it('encode le mot-clé à retirer', async () => {
    const fetchMock = mockFetch({ status: 204 });

    await untrackKeyword('lessive liquide');

    expect(fetchMock).toHaveBeenCalledWith(
      `${API}/keywords/lessive%20liquide`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('suit et retire une URL produit', async () => {
    const fetchMock = mockFetch({ status: 201 });

    await trackProductUrl('https://www.amazon.fr/dp/B0TEST0001/');
    await untrackProductUrl('aWQ');

    expect(fetchMock.mock.calls[0][0]).toBe(`${API}/product-urls`);
    expect(fetchMock.mock.calls[1]).toEqual([
      `${API}/product-urls/aWQ`,
      expect.objectContaining({ method: 'DELETE' }),
    ]);
  });

  it('ajoute et retire un favori', async () => {
    const fetchMock = mockFetch({ status: 201 });

    await addFavorite('aWQ');
    await removeFavorite('aWQ');

    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ id: 'aWQ' }),
    });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'DELETE' });
  });

  it('supporte un succès sans corps', async () => {
    // POST répond 201 sans contenu et DELETE 204 : se fier au seul statut 204
    // ferait échouer le parsing JSON d'un 201 pourtant réussi.
    mockFetch({ status: 201, body: '' });

    await expect(trackKeyword('lessive')).resolves.toBeUndefined();
  });
});

describe('erreurs', () => {
  it('transforme une réponse en échec en ApiError', async () => {
    errorResponse(409, { code: 'KEYWORD_ALREADY_TRACKED', message: 'Le mot-clé est déjà suivi.' });

    await expect(trackKeyword('lessive')).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      code: 'KEYWORD_ALREADY_TRACKED',
      message: 'Le mot-clé est déjà suivi.',
    });
  });

  it('assemble les messages multiples de la validation', async () => {
    // La ValidationPipe du backend renvoie un tableau de messages.
    errorResponse(400, { code: null, message: ['keyword must be a string', 'keyword should not be empty'] });

    await expect(trackKeyword('')).rejects.toThrow(
      'keyword must be a string, keyword should not be empty',
    );
  });

  it('survit à une réponse non JSON', async () => {
    // Cas typique : un 502 émis par un proxy, ou backend arrêté.
    mockFetch({ ok: false, status: 502 });

    await expect(getKeywords()).rejects.toMatchObject({
      status: 502,
      code: null,
      message: '/keywords → HTTP 502',
    });
  });

  it('expose ApiError pour que l’appelant puisse trier', () => {
    const error = new ApiError(404, 'PRODUCT_NOT_FOUND', 'inconnu');

    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(404);
  });
});

describe('getProduct', () => {
  it('renvoie la fiche', async () => {
    jsonResponse({ id: 'aWQ', title: 'Lessive' });

    await expect(getProduct('aWQ')).resolves.toMatchObject({ title: 'Lessive' });
  });

  it.each([[404], [400]])('renvoie null sur un %i', async (status) => {
    // Une URL bricolée à la main (400) et un produit disparu (404) donnent la
    // même page côté UI : « produit inconnu ».
    errorResponse(status, { code: 'X', message: 'nope' });

    await expect(getProduct('aWQ')).resolves.toBeNull();
  });

  it('laisse remonter les autres erreurs', async () => {
    errorResponse(500, { code: 'X', message: 'boom' });

    await expect(getProduct('aWQ')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('mise à jour de l’application', () => {
  it('lit l’état des versions', async () => {
    const fetchMock = jsonResponse({ updateAvailable: true });

    await expect(getUpdateStatus()).resolves.toEqual({ updateAvailable: true });
    expect(fetchMock).toHaveBeenCalledWith(`${API}/platform/status`, { cache: 'no-store' });
  });

  it('relaie le jeton administrateur en Bearer et renvoie les composants redémarrés', async () => {
    const fetchMock = jsonResponse({ restarted: ['price-tracker-backend'] });

    await expect(redeploy('mon-jeton')).resolves.toEqual(['price-tracker-backend']);
    expect(fetchMock).toHaveBeenCalledWith(`${API}/platform/redeploy`, {
      cache: 'no-store',
      method: 'POST',
      headers: { authorization: 'Bearer mon-jeton' },
    });
  });

  it('remonte un refus du backend avec son code', async () => {
    errorResponse(401, { code: 'INVALID_ADMIN_TOKEN', message: 'Jeton administrateur invalide.' });

    await expect(redeploy('faux')).rejects.toMatchObject({ status: 401, code: 'INVALID_ADMIN_TOKEN' });
  });
});

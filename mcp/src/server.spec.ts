import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BackendClient } from './backend/client.js';
import { createMcpServer } from './server.js';
import {
  aDashboard,
  aFavoriteStationDetailsList,
  aFuelStationSearch,
  aProductDetail,
  aScoredProduct,
  aTrackedUrlSummary,
} from './testing/fixtures.js';

/**
 * Tests de bout en bout du serveur MCP, sans HTTP ni backend : un vrai client
 * MCP parle au vrai serveur par un transport en mémoire, et seul `fetch` est
 * remplacé. On vérifie donc ce que l'agent verra réellement.
 */

interface Route {
  status?: number;
  body: unknown;
}

function connect(routes: Record<string, Route>): Promise<{ client: Client; calls: string[] }> {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace('http://backend', '');
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    const route = routes[path.split('?')[0]];
    if (route === undefined) return new Response(JSON.stringify({ message: 'route de test absente' }), { status: 404 });
    // `null` et non `''` : le constructeur `Response` interdit un corps sur un 204.
    return new Response(route.body === undefined ? null : JSON.stringify(route.body), {
      status: route.status ?? 200,
    });
  }) as unknown as typeof fetch;

  const backend = new BackendClient({ baseUrl: 'http://backend', timeoutMs: 1000, fetchImpl });
  const server = createMcpServer(backend);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });

  return Promise.all([server.connect(serverTransport), client.connect(clientTransport)]).then(() => ({
    client,
    calls,
  }));
}

/** `callTool` renvoie une union avec l'ancienne forme `toolResult` : on cible la nouvelle. */
function textOf(result: unknown): string {
  const { content } = result as { content?: { type: string; text: string }[] };
  assert.ok(content !== undefined, "le résultat d'outil n'a pas de contenu");
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

describe('serveur MCP', () => {
  it('expose les seize outils attendus', async () => {
    const { client } = await connect({});

    const { tools } = await client.listTools();

    assert.deepEqual(
      tools.map((tool) => tool.name).sort(),
      [
        'add_favorite',
        'add_favorite_station',
        'find_fuel_stations',
        'get_dashboard',
        'get_product',
        'list_favorite_stations',
        'list_favorites',
        'list_keywords',
        'list_tracked_urls',
        'remove_favorite',
        'remove_favorite_station',
        'search_products',
        'track_keyword',
        'track_product_url',
        'untrack_keyword',
        'untrack_product_url',
      ],
    );
  });

  // Un client MCP se sert de ces annotations pour décider s'il demande une
  // confirmation : un outil d'écriture annoncé en lecture seule serait un piège.
  it('annonce correctement lecture seule et destruction', async () => {
    const { client } = await connect({});

    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool.annotations]));

    assert.equal(byName.get('search_products')?.readOnlyHint, true);
    assert.equal(byName.get('track_keyword')?.readOnlyHint, false);
    assert.equal(byName.get('untrack_keyword')?.destructiveHint, true);
    assert.equal(byName.get('track_product_url')?.readOnlyHint, false);
    assert.equal(byName.get('untrack_product_url')?.destructiveHint, true);
    assert.equal(byName.get('find_fuel_stations')?.readOnlyHint, true);
    assert.equal(byName.get('list_favorite_stations')?.readOnlyHint, true);
  });

  // add_favorite / remove_favorite sont idempotents et non destructifs :
  // contrairement à untrack_keyword, retirer un favori ne coupe aucune collecte.
  it('annonce add_favorite et remove_favorite comme idempotents et non destructifs', async () => {
    const { client } = await connect({});

    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool.annotations]));

    for (const name of ['add_favorite', 'remove_favorite', 'add_favorite_station', 'remove_favorite_station']) {
      assert.equal(byName.get(name)?.readOnlyHint, false);
      assert.equal(byName.get(name)?.destructiveHint, false);
      assert.equal(byName.get(name)?.idempotentHint, true);
    }
  });

  it('rend le tableau de bord en texte lisible', async () => {
    const { client } = await connect({ '/api/v1/dashboard': { body: aDashboard() } });

    const result = await client.callTool({ name: 'get_dashboard', arguments: {} });

    assert.notEqual(result.isError, true);
    assert.match(textOf(result), /Produits suivis : 42/);
  });

  it('traduit les arguments de recherche en filtres du backend', async () => {
    const { client, calls } = await connect({
      '/api/v1/keywords/lessive%20liquide/products': {
        body: { items: [aScoredProduct()], total: 1, pageCount: 1, keywordTotal: 42, keywordDealCount: 3 },
      },
    });

    const result = await client.callTool({
      name: 'search_products',
      arguments: { keyword: 'lessive liquide', dealsOnly: true, maxPrice: 20, sort: 'price_asc' },
    });

    assert.deepEqual(calls, [
      'GET /api/v1/keywords/lessive%20liquide/products?deals=1&max=20&sort=price_asc',
    ]);
    assert.match(textOf(result), /BONNE AFFAIRE/);
  });

  it('renvoie la fiche produit et son historique', async () => {
    const { client } = await connect({ '/api/v1/products/abc': { body: aProductDetail() } });

    const result = await client.callTool({ name: 'get_product', arguments: { id: 'abc' } });

    assert.match(textOf(result), /Historique de prix \(3 relevés\)/);
  });

  it('limite l\'historique quand on le demande', async () => {
    const { client } = await connect({ '/api/v1/products/abc': { body: aProductDetail() } });

    const result = await client.callTool({
      name: 'get_product',
      arguments: { id: 'abc', historyDays: 1 },
    });

    assert.match(textOf(result), /2026-08-08/);
    assert.doesNotMatch(textOf(result), /2026-08-07/);
  });

  it('suit un mot-clé', async () => {
    const { client, calls } = await connect({ '/api/v1/keywords': { status: 201, body: undefined } });

    const result = await client.callTool({
      name: 'track_keyword',
      arguments: { keyword: 'café en grains' },
    });

    assert.deepEqual(calls, ['POST /api/v1/keywords']);
    assert.match(textOf(result), /ajouté au suivi/);
  });

  it('retire un mot-clé', async () => {
    const { client, calls } = await connect({
      '/api/v1/keywords/caf%C3%A9%20en%20grains': { status: 204, body: undefined },
    });

    const result = await client.callTool({
      name: 'untrack_keyword',
      arguments: { keyword: 'café en grains' },
    });

    assert.deepEqual(calls, ['DELETE /api/v1/keywords/caf%C3%A9%20en%20grains']);
    assert.match(textOf(result), /retiré du suivi/);
  });

  it('liste les URLs suivies individuellement', async () => {
    const { client } = await connect({
      '/api/v1/product-urls': { body: [aTrackedUrlSummary()] },
    });

    const result = await client.callTool({ name: 'list_tracked_urls', arguments: {} });

    assert.match(textOf(result), /Lessive liquide 3 L/);
  });

  it('suit une URL produit', async () => {
    const { client, calls } = await connect({ '/api/v1/product-urls': { status: 201, body: undefined } });

    const result = await client.callTool({
      name: 'track_product_url',
      arguments: { url: 'https://www.amazon.fr/dp/B0TEST0001/' },
    });

    assert.deepEqual(calls, ['POST /api/v1/product-urls']);
    assert.match(textOf(result), /ajoutée au suivi individuel/);
  });

  it('retire une URL du suivi individuel', async () => {
    const { client, calls } = await connect({
      '/api/v1/product-urls/abc': { status: 204, body: undefined },
    });

    const result = await client.callTool({ name: 'untrack_product_url', arguments: { id: 'abc' } });

    assert.deepEqual(calls, ['DELETE /api/v1/product-urls/abc']);
    assert.match(textOf(result), /retirée du suivi individuel/);
  });

  it('liste les favoris avec un aperçu de leur historique', async () => {
    const { client } = await connect({ '/api/v1/favorites': { body: [aProductDetail()] } });

    const result = await client.callTool({ name: 'list_favorites', arguments: {} });

    assert.match(textOf(result), /1 produit\(s\) favori\(s\)/);
  });

  it('ajoute un favori', async () => {
    const { client, calls } = await connect({ '/api/v1/favorites': { status: 201, body: undefined } });

    const result = await client.callTool({ name: 'add_favorite', arguments: { id: 'abc' } });

    assert.deepEqual(calls, ['POST /api/v1/favorites']);
    assert.match(textOf(result), /ajouté aux favoris/);
  });

  it('retire un favori', async () => {
    const { client, calls } = await connect({
      '/api/v1/favorites/abc': { status: 204, body: undefined },
    });

    const result = await client.callTool({ name: 'remove_favorite', arguments: { id: 'abc' } });

    assert.deepEqual(calls, ['DELETE /api/v1/favorites/abc']);
    assert.match(textOf(result), /retiré des favoris/);
  });

  it('traduit une recherche de stations en paramètres du backend', async () => {
    const { client, calls } = await connect({ '/api/v1/fuel-stations': { body: aFuelStationSearch() } });

    const result = await client.callTool({
      name: 'find_fuel_stations',
      arguments: { latitude: 45.76, longitude: 4.84, radiusKm: 5, fuel: 'gazole', sort: 'price' },
    });

    assert.notEqual(result.isError, true);
    assert.deepEqual(calls, [
      'GET /api/v1/fuel-stations?lat=45.76&lng=4.84&radiusKm=5&fuel=gazole&sort=price',
    ]);
    assert.match(textOf(result), /dans un rayon de 5 km vendant du Gazole/);
  });

  it('refuse un rayon au-delà du plafond du backend sans appel réseau', async () => {
    const { client, calls } = await connect({});

    const result = await client.callTool({
      name: 'find_fuel_stations',
      arguments: { latitude: 45.76, longitude: 4.84, radiusKm: 31 },
    });

    assert.equal(result.isError, true);
    assert.deepEqual(calls, []);
  });

  // Le tri par prix sans carburant est une règle du backend : son 400 doit
  // revenir lisible, pour que l'agent corrige son appel.
  it('rapporte le refus du backend pour un tri par prix sans carburant', async () => {
    const { client } = await connect({
      '/api/v1/fuel-stations': {
        status: 400,
        body: { code: 'INVALID_STATION_SEARCH', message: 'Le tri « price » exige un carburant (« fuel »).' },
      },
    });

    const result = await client.callTool({
      name: 'find_fuel_stations',
      arguments: { latitude: 45.76, longitude: 4.84, sort: 'price' },
    });

    assert.equal(result.isError, true);
    assert.match(textOf(result), /400 \[INVALID_STATION_SEARCH\].*exige un carburant/);
  });

  it('liste les stations favorites avec leurs prévisions', async () => {
    const { client, calls } = await connect({
      '/api/v1/fuel-stations/favorites/details': { body: aFavoriteStationDetailsList() },
    });

    const result = await client.callTool({ name: 'list_favorite_stations', arguments: {} });

    assert.deepEqual(calls, ['GET /api/v1/fuel-stations/favorites/details']);
    assert.match(textOf(result), /risque de rupture avant/);
  });

  it('ajoute une station favorite par PUT', async () => {
    const { client, calls } = await connect({
      '/api/v1/fuel-stations/favorites/69003001': { status: 204, body: undefined },
    });

    const result = await client.callTool({ name: 'add_favorite_station', arguments: { id: '69003001' } });

    assert.deepEqual(calls, ['PUT /api/v1/fuel-stations/favorites/69003001']);
    assert.match(textOf(result), /ajoutée aux favorites/);
  });

  it('retire une station favorite', async () => {
    const { client, calls } = await connect({
      '/api/v1/fuel-stations/favorites/69003001': { status: 204, body: undefined },
    });

    const result = await client.callTool({ name: 'remove_favorite_station', arguments: { id: '69003001' } });

    assert.deepEqual(calls, ['DELETE /api/v1/fuel-stations/favorites/69003001']);
    assert.match(textOf(result), /retirée des favorites/);
  });

  // Un identifiant non numérique ne doit pas devenir un chemin d'URL arbitraire.
  it('refuse un identifiant de station non numérique sans appel réseau', async () => {
    const { client, calls } = await connect({});

    const result = await client.callTool({ name: 'add_favorite_station', arguments: { id: '../keywords' } });

    assert.equal(result.isError, true);
    assert.deepEqual(calls, []);
  });

  // Une erreur métier doit revenir comme un résultat d'outil en échec : l'agent
  // peut alors corriger son appel, là où une exception de protocole couperait
  // court à la conversation.
  it('rapporte une erreur métier sans casser le protocole', async () => {
    const { client } = await connect({
      '/api/v1/keywords': {
        status: 409,
        body: { code: 'KEYWORD_ALREADY_TRACKED', message: 'Mot-clé déjà suivi' },
      },
    });

    const result = await client.callTool({
      name: 'track_keyword',
      arguments: { keyword: 'lessive liquide' },
    });

    assert.equal(result.isError, true);
    assert.match(textOf(result), /409 \[KEYWORD_ALREADY_TRACKED\] : Mot-clé déjà suivi/);
  });

  it('rejette un argument invalide avant tout appel réseau', async () => {
    const { client, calls } = await connect({});

    const result = await client.callTool({
      name: 'search_products',
      arguments: { keyword: 'lessive liquide', sort: 'par_couleur' },
    });

    assert.equal(result.isError, true);
    assert.deepEqual(calls, []);
  });
});

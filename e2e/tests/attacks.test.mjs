import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  AGENT,
  ALICE,
  BOB,
  INTRUDER,
  PRODUCT_A,
  PRODUCT_B,
  PUBLIC_URL,
  QUOTAS,
  SECRETS,
  STATION,
  productId,
} from '../lib/fixtures.mjs';
import {
  callServerAction,
  internalToken,
  serverActionIds,
  sessionCookie,
  tamper,
} from '../lib/forge.mjs';
import { FRONTEND_DIR, startStack } from '../lib/stack.mjs';

/**
 * Tests d'attaque contre la pile réelle.
 *
 * Chaque scénario se place du point de vue de quelqu'un qui contrôle
 * entièrement son navigateur — cookies, en-têtes, requêtes HTTP brutes — et
 * cherche à lire ou modifier ce qui ne lui appartient pas. Le jugement porte
 * sur l'**état de la base** après coup, pas seulement sur un code HTTP : une
 * attaque « refusée » qui aurait quand même écrit serait un échec.
 *
 * Chaque refus a son témoin positif (la même requête, légitime, réussit) :
 * sans lui, un test d'interdiction passerait aussi sur une requête mal formée.
 */

let stack;
let cookies;
let actions;

before(async () => {
  stack = await startStack();
  cookies = {
    alice: await sessionCookie(ALICE, SECRETS.session),
    bob: await sessionCookie(BOB, SECRETS.session),
    intruder: await sessionCookie(INTRUDER, SECRETS.session),
    aliceOtherSecret: await sessionCookie(ALICE, 'un-autre-secret-'.padEnd(64, 'x')),
  };
  actions = serverActionIds();
});

after(async () => {
  await stack?.stop();
});

/** Fait échouer avec les journaux des services : un 500 inexpliqué ne se débogue pas sans eux. */
function withLogs(message) {
  return `${message}\n\n${stack.logs().slice(-4000)}`;
}

function page(path, cookie, base = stack.frontendUrl) {
  return fetch(base + path, { headers: cookie ? { cookie } : {}, redirect: 'manual' });
}

/** GET sans normalisation du chemin (contrairement à `fetch`), sans cookie. */
function rawGet(base, path) {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    request({ hostname, port, path, method: 'GET' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location ?? '', body }));
    })
      .on('error', reject)
      .end();
  });
}

function api(path, { token, method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  return fetch(stack.backendUrl + '/api/v1' + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

const tokenFor = (sub) => internalToken({ sub, secret: SECRETS.backend });

async function subscribersOf(keyword) {
  return (await stack.db.collection('keywords').findOne({ keyword }))?.subscribers;
}

describe('backend : seul un jeton signé par un émetteur connu ouvre l’API', () => {
  const PERSONAL_ROUTES = [
    ['GET', '/keywords'],
    ['GET', '/dashboard'],
    ['GET', '/favorites'],
    ['GET', '/product-urls'],
    ['GET', '/fuel-stations/favorites'],
    ['GET', '/profile'],
    ['PUT', '/profile'],
    ['GET', `/products/${productId(PRODUCT_A)}`],
    ['GET', '/keywords/lessive/products'],
    ['GET', '/fuel-stations?lat=45.75&lng=4.85'],
    ['DELETE', '/keywords/lessive'],
    ['DELETE', `/favorites/${productId(PRODUCT_A)}`],
    ['DELETE', `/fuel-stations/favorites/${STATION}`],
  ];

  it('témoin : un jeton du frontend au nom d’Alice ouvre ses mots-clés', async () => {
    const response = await api('/keywords', { token: tokenFor(ALICE) });
    assert.equal(response.status, 200, withLogs('le jeton légitime est refusé'));
    assert.deepEqual((await response.json()).map((k) => k.keyword), ['cafe', 'lessive']);
  });

  it('refuse toute route (hors sondes) sans jeton', async () => {
    for (const [method, path] of PERSONAL_ROUTES) {
      const response = await api(path, { method });
      assert.equal(response.status, 401, `${method} ${path} → ${response.status}`);
    }
    assert.deepEqual(await subscribersOf('lessive'), [ALICE]);
  });

  it('laisse les sondes publiques, sans rien révéler', async () => {
    const response = await fetch(stack.backendUrl + '/health/ready');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', mongodb: 'up' });
  });

  const FORGED = {
    'signé avec un autre secret': () => internalToken({ sub: ALICE, secret: 'x'.repeat(64) }),
    'algorithme « none »': () => internalToken({ sub: ALICE, secret: SECRETS.backend, alg: 'none' }),
    'algorithme HS512': () => internalToken({ sub: ALICE, secret: SECRETS.backend, alg: 'HS512' }),
    'expiré depuis une heure': () =>
      internalToken({ sub: ALICE, secret: SECRETS.backend, iat: Math.floor(Date.now() / 1000) - 3600 }),
    'valable un an': () => internalToken({ sub: ALICE, secret: SECRETS.backend, ttl: 365 * 86400 }),
    'destiné à un autre service': () => internalToken({ sub: ALICE, secret: SECRETS.backend, aud: 'autre' }),
    'émetteur inconnu': () => internalToken({ sub: ALICE, secret: SECRETS.backend, iss: 'pirate' }),
    'sujet qui n’est pas une adresse': () => internalToken({ sub: 'admin', secret: SECRETS.backend }),
  };
  for (const [label, forge] of Object.entries(FORGED)) {
    it(`refuse un jeton ${label}`, async () => {
      const response = await api('/keywords/lessive', { token: forge(), method: 'DELETE' });
      assert.equal(response.status, 401);
      assert.deepEqual(await subscribersOf('lessive'), [ALICE]);
    });
  }

  it('refuse un jeton dont le contenu a été modifié après signature (changement d’utilisateur)', async () => {
    const [header, , signature] = tokenFor(BOB).split('.');
    const payload = Buffer.from(
      JSON.stringify({
        sub: ALICE,
        iss: 'price-tracker-frontend',
        aud: 'price-tracker-backend',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60,
      }),
    ).toString('base64url');
    const response = await api('/keywords', { token: `${header}.${payload}.${signature}` });
    assert.equal(response.status, 401);
  });
});

describe('backend : le secret du MCP n’ouvre que le compte du MCP', () => {
  const mcpToken = (sub) =>
    internalToken({ sub, secret: SECRETS.mcp, iss: 'price-tracker-mcp' });

  it('témoin : le MCP agit pour son propre compte', async () => {
    const response = await api('/keywords', { token: mcpToken(AGENT) });
    assert.equal(response.status, 200, withLogs('le jeton MCP légitime est refusé'));
  });

  it('refuse le MCP au nom d’Alice, même correctement signé', async () => {
    const read = await api('/favorites', { token: mcpToken(ALICE) });
    const write = await api('/keywords/lessive', { token: mcpToken(ALICE), method: 'DELETE' });

    assert.equal(read.status, 401);
    assert.equal(write.status, 401);
    assert.deepEqual(await subscribersOf('lessive'), [ALICE]);
  });

  it('refuse le secret du MCP présenté comme un jeton du frontend', async () => {
    const response = await api('/keywords', {
      token: internalToken({ sub: ALICE, secret: SECRETS.mcp, iss: 'price-tracker-frontend' }),
    });
    assert.equal(response.status, 401);
  });
});

describe('frontend : pas de page sans session valide', () => {
  const PAGES = ['/', '/keywords', '/keyword/lessive', '/products', '/favorites', '/fuel', `/product/${productId(PRODUCT_A)}`];

  it('témoin : Alice voit ses pages', async () => {
    for (const path of PAGES) {
      const response = await page(path, cookies.alice);
      assert.equal(response.status, 200, withLogs(`${path} → ${response.status} pour Alice`));
    }
  });

  const SESSIONS = {
    'sans cookie': () => undefined,
    'avec un cookie altéré d’un caractère': () => tamper(cookies.alice),
    'avec un cookie chiffré par un autre secret': () => cookies.aliceOtherSecret,
    'avec un compte hors liste blanche': () => cookies.intruder,
    'avec un cookie inventé': () => 'authjs.session-token=eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2Q0JDLUhTNTEyIn0.x.y.z.w',
  };
  for (const [label, cookie] of Object.entries(SESSIONS)) {
    it(`renvoie vers /login ${label}`, async () => {
      for (const path of PAGES) {
        const response = await page(path, cookie());
        assert.equal(response.status, 307, `${path} → ${response.status}`);
        assert.match(response.headers.get('location'), /\/login\?callbackUrl=/);
      }
    });
  }

  it('n’expose aucune session pour un cookie altéré', async () => {
    const response = await page('/api/auth/session', tamper(cookies.alice));
    assert.equal(await response.text(), 'null');
  });
});

describe('frontend : la PWA s’installe sans session, sans rouvrir de page', () => {
  // Le navigateur télécharge le manifeste et les icônes sans cookie : redirigés
  // vers /login, l'installation échouerait sans message.
  const INSTALL_FILES = {
    '/manifest.webmanifest': /^application\/manifest\+json/,
    '/icons/icon-192.png': /^image\/png/,
    '/icons/icon-512.png': /^image\/png/,
    '/icons/maskable-192.png': /^image\/png/,
    '/icons/maskable-512.png': /^image\/png/,
    '/icons/apple-touch-icon.png': /^image\/png/,
  };

  it('sert le manifeste et les icônes sans cookie', async () => {
    for (const [path, type] of Object.entries(INSTALL_FILES)) {
      const response = await page(path);
      assert.equal(response.status, 200, withLogs(`${path} → ${response.status}`));
      assert.match(response.headers.get('content-type'), type, path);
    }
  });

  it('chaque icône du manifeste est servie', async () => {
    const manifest = await (await page('/manifest.webmanifest')).json();
    assert.ok(manifest.icons.length > 0);
    for (const { src } of manifest.icons) {
      assert.equal((await page(src)).status, 200, src);
    }
  });

  it('la page de connexion annonce le manifeste et l’icône iOS', async () => {
    const html = await (await page('/login')).text();
    assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest"/);
    assert.match(html, /<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png"/);
  });

  // Les exceptions du matcher sont des préfixes : vérifier qu'aucun chemin
  // voisin, ni une remontée de dossier, n'atteint une page sans session.
  // Envoyés en HTTP brut : `fetch` résoudrait lui-même `..` et `%2e%2e`
  // (règle WHATWG URL) et ne testerait que `/fuel`.
  for (const path of [
    '/manifest',
    '/icons',
    '/icons/../fuel',
    '/icons/%2e%2e/fuel',
    '/icons/..%2ffuel',
    '/manifest.webmanifest/../fuel',
  ]) {
    it(`ne sert aucune page sans session pour ${path}`, async () => {
      const { status, location, body } = await rawGet(stack.frontendUrl, path);
      assert.ok([307, 308, 400, 404].includes(status), `${path} → ${status}`);
      if (status === 307) assert.match(location, /\/login\?callbackUrl=/);
      else if (status === 308) assert.equal((await rawGet(stack.frontendUrl, location)).status, 307, `${path} → ${location}`);
      else assert.doesNotMatch(body, /Mes stations|>Carburants<\/h1>/);
    });
  }
});

describe('frontend : chacun ne voit que ses propres données', () => {
  it('ne montre pas à Bob les mots-clés d’Alice', async () => {
    const alice = await (await page('/keywords', cookies.alice)).text();
    const bob = await (await page('/keywords', cookies.bob)).text();

    assert.match(alice, /lessive/);
    assert.doesNotMatch(bob, /lessive|cafe/);
  });

  it('ne montre pas à Bob les favoris d’Alice', async () => {
    const alice = await (await page('/favorites', cookies.alice)).text();
    const bob = await (await page('/favorites', cookies.bob)).text();

    assert.match(alice, /Lessive Alice 3L/);
    assert.doesNotMatch(bob, /Lessive Alice 3L/);
  });

  it('ne montre pas à Bob le numéro de téléphone d’Alice', async () => {
    // Écrit comme le backend l'enregistre : c'est le destinataire des alertes.
    await stack.db.collection('user_profiles').replaceOne(
      { _id: ALICE },
      { phone: '+33612345678', alertFuels: ['gazole'], updatedAt: new Date() },
      { upsert: true },
    );

    const alice = await page('/profile', cookies.alice);
    const bob = await (await page('/profile', cookies.bob)).text();

    assert.equal(alice.status, 200, withLogs(`/profile d’Alice → ${alice.status}`));
    assert.match(await alice.text(), /\+33612345678/);
    // Forme stockée et seule forme affichée (le champ vide porte un exemple
    // « 06 12 34 56 78 » en placeholder, qui n’est pas un numéro).
    assert.doesNotMatch(bob, /33612345678/);
    assert.match(bob, /bob@example\.com/); // témoin : c'est bien la page de Bob
  });
});

/**
 * Les Server Actions sont des points d'entrée HTTP publics : n'importe qui
 * peut les appeler avec les arguments de son choix. Ce qui doit tenir : elles
 * n'agissent jamais que sur les données de la session, quels que soient les
 * arguments.
 */
describe('frontend : les Server Actions n’agissent que pour la session', () => {
  it('trouve les identifiants des actions dans le JavaScript public', () => {
    for (const name of ['deleteKeyword', 'removeFavoriteAction', 'removeFavoriteStationAction']) {
      assert.ok(actions[name], `action ${name} introuvable dans .next/static`);
    }
  });

  it('témoin : Alice retire son mot-clé « cafe » par une action appelée en HTTP brut', async () => {
    const response = await callServerAction(stack.frontendUrl, {
      page: '/keywords',
      actionId: actions.deleteKeyword,
      args: ['cafe'],
      cookie: cookies.alice,
    });

    assert.equal(response.status, 200, withLogs(`action légitime → ${response.status}`));
    assert.deepEqual(await subscribersOf('cafe'), []);
  });

  it('Bob ne peut pas retirer le mot-clé d’Alice', async () => {
    const response = await callServerAction(stack.frontendUrl, {
      page: '/keywords',
      actionId: actions.deleteKeyword,
      args: ['lessive'],
      cookie: cookies.bob,
    });

    assert.equal(response.status, 200); // l'action s'exécute… pour Bob, qui ne suit rien
    assert.deepEqual(await subscribersOf('lessive'), [ALICE]);
  });

  it('Bob ne peut pas se faire passer pour Alice en ajoutant un argument', async () => {
    await callServerAction(stack.frontendUrl, {
      page: '/keywords',
      actionId: actions.deleteKeyword,
      args: ['lessive', { userId: ALICE, email: ALICE }],
      cookie: cookies.bob,
    });

    assert.deepEqual(await subscribersOf('lessive'), [ALICE]);
  });

  it('Bob ne peut pas retirer le favori d’Alice', async () => {
    await callServerAction(stack.frontendUrl, {
      page: '/favorites',
      actionId: actions.removeFavoriteAction,
      args: [productId(PRODUCT_A)],
      cookie: cookies.bob,
    });

    assert.ok(await stack.db.collection('favorites').findOne({ userId: ALICE, url: PRODUCT_A }));
  });

  it('Bob ne peut pas retirer la station favorite d’Alice', async () => {
    await callServerAction(stack.frontendUrl, {
      page: '/fuel',
      actionId: actions.removeFavoriteStationAction,
      args: [STATION],
      cookie: cookies.bob,
    });

    assert.ok(
      await stack.db.collection('favorite_stations').findOne({ userId: ALICE, stationId: STATION }),
    );
  });

  it('un anonyme ne peut appeler aucune action', async () => {
    const response = await callServerAction(stack.frontendUrl, {
      page: '/keywords',
      actionId: actions.deleteKeyword,
      args: ['lessive'],
    });

    assert.equal(response.status, 307);
    assert.deepEqual(await subscribersOf('lessive'), [ALICE]);
  });

  it('un autre site ne peut pas déclencher une action avec le cookie d’Alice (CSRF)', async () => {
    const response = await callServerAction(stack.frontendUrl, {
      page: '/keywords',
      actionId: actions.deleteKeyword,
      args: ['lessive'],
      cookie: cookies.alice,
      origin: 'https://evil.example',
    });

    assert.notEqual(response.status, 200);
    assert.deepEqual(await subscribersOf('lessive'), [ALICE]);
  });
});

describe('frontend : redirections et transport', () => {
  it('ne renvoie jamais hors du site après la connexion', async () => {
    for (const callbackUrl of ['https://evil.example/favorites', '//evil.example', '/\\evil.example']) {
      const response = await page(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`, cookies.alice);
      const location = response.headers.get('location') ?? '';
      assert.equal(response.status, 307);
      assert.doesNotMatch(location, /evil/, `${callbackUrl} → ${location}`);
    }
  });

  it('avec AUTH_URL en HTTPS, pose des cookies Secure à préfixe __Host-/__Secure-', async () => {
    const response = await page('/api/auth/csrf', undefined, stack.publicFrontendUrl);
    const setCookies = response.headers.getSetCookie();

    assert.ok(setCookies.length > 0, 'aucun cookie posé');
    for (const cookie of setCookies) {
      assert.match(cookie, /^__(Host|Secure)-/, cookie);
      assert.match(cookie, /;\s*Secure/i, cookie);
      assert.match(cookie, /;\s*HttpOnly/i, cookie);
    }
  });

  it('avec AUTH_URL en HTTPS, ignore un cookie de session sans préfixe __Secure-', async () => {
    const response = await page('/keywords', cookies.alice, stack.publicFrontendUrl);

    assert.equal(response.status, 307);
    assert.ok(response.headers.get('location').startsWith(`${PUBLIC_URL}/login`));
  });

  it('avec AUTH_URL en HTTPS, témoin : accepte le cookie __Secure- d’Alice', async () => {
    const secure = await sessionCookie(ALICE, SECRETS.session, '__Secure-authjs.session-token');
    const response = await page('/keywords', secure, stack.publicFrontendUrl);

    assert.equal(response.status, 200, withLogs(`cookie __Secure- refusé → ${response.status}`));
  });
});

describe('frontend : aucun secret ne parvient au navigateur', () => {
  it('ni dans les pages, ni dans la session exposée', async () => {
    const bodies = await Promise.all(
      ['/keywords', '/favorites', '/api/auth/session'].map(async (path) =>
        (await page(path, cookies.alice)).text(),
      ),
    );
    for (const body of bodies) {
      for (const [name, secret] of Object.entries(SECRETS)) {
        assert.ok(!body.includes(secret), `secret ${name} présent dans une réponse`);
      }
    }
  });

  it('ni dans le JavaScript envoyé au navigateur', () => {
    const files = [];
    (function walk(dir) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (path.endsWith('.js')) files.push(path);
      }
    })(join(FRONTEND_DIR, '.next', 'static'));
    assert.ok(files.length > 0);

    for (const file of files) {
      const code = readFileSync(file, 'utf8');
      for (const marker of ['BACKEND_AUTH_SECRET', 'AUTH_GOOGLE_SECRET', 'createHmac', 'price-tracker-backend']) {
        assert.ok(!code.includes(marker), `« ${marker} » trouvé dans ${file}`);
      }
    }
  });
});

describe('quotas : un compte ne peut pas épuiser le budget de crawl commun', () => {
  it(`refuse le ${QUOTAS.keywords + 1}e mot-clé de Bob, sans rien écrire`, async () => {
    for (let i = 1; i <= QUOTAS.keywords; i++) {
      const ok = await api('/keywords', { token: tokenFor(BOB), method: 'POST', body: { keyword: `bob-${i}` } });
      assert.equal(ok.status, 201, withLogs(`mot-clé ${i} refusé`));
    }

    const refused = await api('/keywords', { token: tokenFor(BOB), method: 'POST', body: { keyword: 'bob-de-trop' } });

    assert.equal(refused.status, 409);
    assert.equal((await refused.json()).code, 'KEYWORD_QUOTA_EXCEEDED');
    assert.equal(await subscribersOf('bob-de-trop'), undefined);
  });

  it('ne compte pas les mots-clés des autres', async () => {
    // Alice suit encore « lessive » : rejoindre ce mot-clé lui est toujours
    // possible, le quota de Bob n'y change rien.
    const response = await api('/keywords', { token: tokenFor(ALICE), method: 'POST', body: { keyword: 'alice-2' } });
    assert.equal(response.status, 201);
  });

  it(`refuse le ${QUOTAS.trackedUrls + 1}e produit suivi de Bob, favoris compris`, async () => {
    for (const url of [PRODUCT_A, PRODUCT_B]) {
      const ok = await api('/favorites', { token: tokenFor(BOB), method: 'POST', body: { id: productId(url) } });
      assert.equal(ok.status, 201, withLogs(`favori ${url} refusé`));
    }
    const third = 'https://www.amazon.fr/dp/B0TROISIEM/';

    const refused = await api('/favorites', { token: tokenFor(BOB), method: 'POST', body: { id: productId(third) } });

    assert.equal(refused.status, 409);
    assert.equal((await refused.json()).code, 'PRODUCT_URL_QUOTA_EXCEEDED');
    assert.equal(await stack.db.collection('favorites').findOne({ userId: BOB, url: third }), null);
  });

  it('explique le refus à l’utilisateur quand il passe par l’étoile', async () => {
    const response = await callServerAction(stack.frontendUrl, {
      page: `/product/${productId(PRODUCT_A)}`,
      actionId: actions.addFavoriteAction,
      args: [productId('https://www.amazon.fr/dp/B0QUATRIEM/')],
      cookie: cookies.bob,
    });

    assert.equal(response.status, 200, withLogs(`action → ${response.status}`));
    assert.match(await response.text(), /maximum autorisé/);
  });
});

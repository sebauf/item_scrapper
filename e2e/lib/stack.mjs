import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { AGENT, ALICE, BOB, PUBLIC_URL, QUOTAS, SECRETS, seed } from './fixtures.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BACKEND_DIR = join(ROOT, 'backend');
export const FRONTEND_DIR = join(ROOT, 'frontend');

/**
 * La vraie pile, telle qu'elle tourne en production, à trois différences
 * près : MongoDB en mémoire, des secrets de test, et Google remplacé par des
 * cookies de session fabriqués (forge.mjs) — Google n'intervient qu'à la
 * connexion, pas dans ce que ces tests attaquent.
 *
 *  - backend : `node backend/dist/main.js` (le build de production) ;
 *  - frontend « local » : `next start`, sans AUTH_URL (HTTP, comme en dev) ;
 *  - frontend « public » : `next start` avec AUTH_URL en HTTPS, comme en
 *    production — pour vérifier les cookies `Secure`.
 */
export async function startStack() {
  for (const [path, hint] of [
    [join(BACKEND_DIR, 'dist', 'main.js'), 'cd backend && npm ci && npm run build'],
    [join(FRONTEND_DIR, '.next', 'BUILD_ID'), 'cd frontend && npm ci && npm run build'],
  ]) {
    if (!existsSync(path)) throw new Error(`Build absent (${path}). Lancer d'abord : ${hint}`);
  }

  const mongo = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
  const client = await new MongoClient(mongo.getUri()).connect();
  const db = client.db('scrapper');
  await seed(db);

  const [backendPort, localPort, publicPort] = await Promise.all([freePort(), freePort(), freePort()]);
  const backendUrl = `http://127.0.0.1:${backendPort}`;
  const processes = [];

  processes.push(
    launch('backend', 'node', ['dist/main.js'], BACKEND_DIR, {
      MONGODB_URI: mongo.getUri(),
      MONGODB_DATABASE: 'scrapper',
      PORT: String(backendPort),
      BACKEND_AUTH_SECRET: SECRETS.backend,
      MCP_BACKEND_AUTH_SECRET: SECRETS.mcp,
      MCP_USER_EMAIL: AGENT,
      MAX_KEYWORDS_PER_USER: String(QUOTAS.keywords),
      MAX_TRACKED_URLS_PER_USER: String(QUOTAS.trackedUrls),
    }),
  );
  await waitFor(`${backendUrl}/health/ready`, processes);

  const frontendEnv = {
    BACKEND_URL: backendUrl,
    BACKEND_AUTH_SECRET: SECRETS.backend,
    AUTH_SECRET: SECRETS.session,
    AUTH_GOOGLE_ID: 'e2e.apps.googleusercontent.com',
    AUTH_GOOGLE_SECRET: 'e2e-google-secret',
    AUTH_ALLOWED_EMAILS: [ALICE, BOB, AGENT].join(','),
    NEXT_TELEMETRY_DISABLED: '1',
  };
  const next = join(FRONTEND_DIR, 'node_modules', '.bin', 'next');
  processes.push(
    launch('frontend', next, ['start', '-p', String(localPort)], FRONTEND_DIR, frontendEnv),
    launch('frontend-https', next, ['start', '-p', String(publicPort)], FRONTEND_DIR, {
      ...frontendEnv,
      AUTH_URL: PUBLIC_URL,
    }),
  );
  const frontendUrl = `http://127.0.0.1:${localPort}`;
  const publicFrontendUrl = `http://127.0.0.1:${publicPort}`;
  await Promise.all([
    waitFor(`${frontendUrl}/api/health`, processes),
    waitFor(`${publicFrontendUrl}/api/health`, processes),
  ]);

  return {
    db,
    backendUrl,
    frontendUrl,
    publicFrontendUrl,
    logs: () => processes.map((p) => `--- ${p.name}\n${p.output.join('')}`).join('\n'),
    async stop() {
      for (const p of processes) p.child.kill('SIGTERM');
      await client.close();
      await mongo.stop();
    },
  };
}

function launch(name, command, args, cwd, env) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: 'pipe' });
  const output = [];
  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));
  const handle = { name, child, output, exited: null };
  child.on('exit', (code) => {
    handle.exited = code;
  });
  return handle;
}

async function waitFor(url, processes, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const dead = processes.find((p) => p.exited !== null);
    if (dead) throw new Error(`${dead.name} s'est arrêté (code ${dead.exited}) :\n${dead.output.join('')}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // pas encore prêt
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${url} injoignable après ${timeoutMs} ms`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

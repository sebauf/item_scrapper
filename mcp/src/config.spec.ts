import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { McpConfig } from './config.js';

const TOKEN = 'a'.repeat(32);

describe('McpConfig', () => {
  it('applique les valeurs par défaut', () => {
    const config = McpConfig.fromEnv({ MCP_AUTH_TOKEN: TOKEN });

    assert.equal(config.backendUrl, 'http://localhost:3001');
    assert.equal(config.port, 3010);
    assert.equal(config.backendTimeoutMs, 10_000);
    assert.deepEqual([...config.allowedHosts], []);
  });

  it("retire la barre oblique finale de l'URL du backend", () => {
    const config = McpConfig.fromEnv({
      MCP_AUTH_TOKEN: TOKEN,
      BACKEND_URL: 'http://price-tracker-backend/',
    });

    assert.equal(config.backendUrl, 'http://price-tracker-backend');
  });

  // Le serveur est destiné à être joignable hors du cluster : démarrer sans
  // jeton doit être un choix, jamais un oubli.
  it('refuse de démarrer sans jeton', () => {
    assert.throws(() => McpConfig.fromEnv({}), /MCP_AUTH_TOKEN est requise/);
  });

  it('accepte l\'anonymat quand il est demandé explicitement', () => {
    const config = McpConfig.fromEnv({ MCP_ALLOW_ANONYMOUS: 'true' });

    assert.equal(config.authToken, null);
  });

  it('refuse un jeton trop court', () => {
    assert.throws(() => McpConfig.fromEnv({ MCP_AUTH_TOKEN: 'court' }), /au moins 16/);
  });

  it('refuse un port hors bornes', () => {
    assert.throws(() => McpConfig.fromEnv({ MCP_AUTH_TOKEN: TOKEN, PORT: '0' }), /PORT/);
  });

  it('refuse une URL de backend sans schéma', () => {
    assert.throws(
      () => McpConfig.fromEnv({ MCP_AUTH_TOKEN: TOKEN, BACKEND_URL: 'price-tracker-backend' }),
      /BACKEND_URL/,
    );
  });

  it('découpe la liste des hôtes autorisés', () => {
    const config = McpConfig.fromEnv({
      MCP_AUTH_TOKEN: TOKEN,
      MCP_ALLOWED_HOSTS: 'mcp.exemple.fr, mcp.interne ',
    });

    assert.deepEqual([...config.allowedHosts], ['mcp.exemple.fr', 'mcp.interne']);
  });
});

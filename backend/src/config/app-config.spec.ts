import { AppConfig } from './app-config';

/**
 * La promesse de AppConfig : le processus refuse de démarrer sur une
 * configuration douteuse. Ces tests vérifient surtout ce qui *échoue*, parce
 * qu'une variable acceptée à tort se paie plus tard, en production, sur la
 * première requête.
 */
describe('AppConfig', () => {
  const validEnv = {
    MONGODB_URI: 'mongodb://localhost:27017',
    BACKEND_AUTH_SECRET: 's'.repeat(32),
  } as NodeJS.ProcessEnv;

  describe('valeurs par défaut', () => {
    it("n'exige que l'URI Mongo", () => {
      const config = AppConfig.fromEnv(validEnv);

      expect(config.mongodbUri).toBe('mongodb://localhost:27017');
      expect(config.mongodbDatabase).toBe('scrapper');
      expect(config.port).toBe(3001);
      expect(config.corsOrigins).toEqual([]);
    });

    it('accepte une URI mongodb+srv', () => {
      expect(AppConfig.fromEnv({ ...validEnv, MONGODB_URI: 'mongodb+srv://cluster/db' }).mongodbUri).toBe(
        'mongodb+srv://cluster/db',
      );
    });

    it('trime les valeurs', () => {
      const config = AppConfig.fromEnv({
        ...validEnv,
        MONGODB_URI: '  mongodb://localhost:27017  ',
        MONGODB_DATABASE: '  autre  ',
        PORT: ' 8080 ',
      });

      expect(config.mongodbUri).toBe('mongodb://localhost:27017');
      expect(config.mongodbDatabase).toBe('autre');
      expect(config.port).toBe(8080);
    });
  });

  describe('origines CORS', () => {
    it('découpe la liste et ignore les entrées vides', () => {
      const config = AppConfig.fromEnv({
        ...validEnv,
        CORS_ORIGINS: 'https://a.example , ,https://b.example',
      });

      expect(config.corsOrigins).toEqual(['https://a.example', 'https://b.example']);
    });

    it('est figée : personne ne peut ajouter une origine après coup', () => {
      const config = AppConfig.fromEnv({ ...validEnv, CORS_ORIGINS: 'https://a.example' });

      expect(() => (config.corsOrigins as string[]).push('https://pirate.example')).toThrow();
    });
  });

  describe('refus au démarrage', () => {
    it.each([
      ['une URI absente', {}],
      ['une URI vide', { MONGODB_URI: '   ' }],
      ['une URI au mauvais schéma', { MONGODB_URI: 'postgres://localhost' }],
      ['une base vide', { ...validEnv, MONGODB_DATABASE: '   ' }],
      ['un port non numérique', { ...validEnv, PORT: 'huit-mille' }],
      ['un port décimal', { ...validEnv, PORT: '3001.5' }],
      ['un port nul', { ...validEnv, PORT: '0' }],
      ['un port hors bornes', { ...validEnv, PORT: '70000' }],
      ['un secret d’authentification absent', { ...validEnv, BACKEND_AUTH_SECRET: '' }],
      ['un secret d’authentification trop court', { ...validEnv, BACKEND_AUTH_SECRET: 'court' }],
      ['un propriétaire historique mal formé', { ...validEnv, AUTH_LEGACY_OWNER_EMAIL: 'moi' }],
    ])('refuse %s', (_label, env) => {
      expect(() => AppConfig.fromEnv(env)).toThrow(/Configuration invalide/);
    });

    it('rapporte toutes les erreurs en une fois', () => {
      expect(() => AppConfig.fromEnv({ PORT: 'abc' })).toThrow(/MONGODB_URI.*\n.*PORT/s);
    });
  });

  describe('authentification', () => {
    it('lit le secret partagé', () => {
      expect(AppConfig.fromEnv(validEnv).authSecret).toBe('s'.repeat(32));
    });

    it('n’attribue les données historiques à personne par défaut', () => {
      expect(AppConfig.fromEnv(validEnv).legacyOwnerEmail).toBeNull();
    });

    it('normalise l’adresse du propriétaire historique', () => {
      const config = AppConfig.fromEnv({ ...validEnv, AUTH_LEGACY_OWNER_EMAIL: ' Moi@Gmail.com ' });

      expect(config.legacyOwnerEmail?.value).toBe('moi@gmail.com');
    });
  });

  describe('secret du MCP', () => {
    const mcp = { MCP_BACKEND_AUTH_SECRET: 'm'.repeat(32), MCP_USER_EMAIL: 'Agent@Gmail.com' };

    it('n’accepte que le frontend quand le MCP n’est pas configuré', () => {
      expect(AppConfig.fromEnv(validEnv).tokenIssuers.map((i) => i.issuer)).toEqual([
        'price-tracker-frontend',
      ]);
    });

    it('restreint le MCP à son compte', () => {
      const [, mcpIssuer] = AppConfig.fromEnv({ ...validEnv, ...mcp }).tokenIssuers;

      expect(mcpIssuer.issuer).toBe('price-tracker-mcp');
      expect(mcpIssuer.onlySubject?.value).toBe('agent@gmail.com');
    });

    it('refuse un secret MCP identique à celui du frontend', () => {
      expect(() =>
        AppConfig.fromEnv({ ...validEnv, ...mcp, MCP_BACKEND_AUTH_SECRET: 's'.repeat(32) }),
      ).toThrow(/doit différer/);
    });

    it('refuse un secret MCP sans compte', () => {
      expect(() =>
        AppConfig.fromEnv({ ...validEnv, MCP_BACKEND_AUTH_SECRET: 'm'.repeat(32) }),
      ).toThrow(/MCP_USER_EMAIL/);
    });
  });

  describe('quotas', () => {
    it('applique 10 mots-clés et 100 URLs par défaut', () => {
      const config = AppConfig.fromEnv(validEnv);

      expect([config.maxKeywordsPerUser, config.maxTrackedUrlsPerUser]).toEqual([10, 100]);
    });

    it('accepte 0 pour désactiver un quota', () => {
      expect(AppConfig.fromEnv({ ...validEnv, MAX_KEYWORDS_PER_USER: '0' }).maxKeywordsPerUser).toBe(0);
    });

    it.each([['-1'], ['2.5'], ['beaucoup']])('refuse %p', (value) => {
      expect(() => AppConfig.fromEnv({ ...validEnv, MAX_TRACKED_URLS_PER_USER: value })).toThrow(
        /MAX_TRACKED_URLS_PER_USER/,
      );
    });
  });
});

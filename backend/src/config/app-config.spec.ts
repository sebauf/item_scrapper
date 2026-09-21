import { AppConfig } from './app-config';

/**
 * La promesse de AppConfig : le processus refuse de démarrer sur une
 * configuration douteuse. Ces tests vérifient surtout ce qui *échoue*, parce
 * qu'une variable acceptée à tort se paie plus tard, en production, sur la
 * première requête.
 */
describe('AppConfig', () => {
  const validEnv = { MONGODB_URI: 'mongodb://localhost:27017' } as NodeJS.ProcessEnv;

  describe('valeurs par défaut', () => {
    it("n'exige que l'URI Mongo", () => {
      const config = AppConfig.fromEnv(validEnv);

      expect(config.mongodbUri).toBe('mongodb://localhost:27017');
      expect(config.mongodbDatabase).toBe('scrapper');
      expect(config.port).toBe(3001);
      expect(config.corsOrigins).toEqual([]);
    });

    it('accepte une URI mongodb+srv', () => {
      expect(AppConfig.fromEnv({ MONGODB_URI: 'mongodb+srv://cluster/db' }).mongodbUri).toBe(
        'mongodb+srv://cluster/db',
      );
    });

    it('trime les valeurs', () => {
      const config = AppConfig.fromEnv({
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
    ])('refuse %s', (_label, env) => {
      expect(() => AppConfig.fromEnv(env)).toThrow(/Configuration invalide/);
    });

    it('rapporte toutes les erreurs en une fois', () => {
      expect(() => AppConfig.fromEnv({ PORT: 'abc' })).toThrow(/MONGODB_URI.*\n.*PORT/s);
    });
  });
});

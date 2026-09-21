import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { closeApp, createTestApp, jsonOf } from 'src/testing/http';
import { TrackKeywordCommand } from '../application/commands/track-keyword.command';
import { UntrackKeywordCommand } from '../application/commands/untrack-keyword.command';
import { ListKeywordSummariesQuery } from '../application/queries/list-keyword-summaries.query';
import {
  KeywordSummary,
  KeywordSummaryReadModel,
} from '../application/ports/keyword-summary.read-model';
import { KeywordRepository } from '../domain/keyword.repository';
import { InMemoryKeywordRepository } from '../testing/in-memory-keyword.repository';
import { KeywordController } from './keyword.controller';

class FakeKeywordSummaryReadModel extends KeywordSummaryReadModel {
  constructor(private readonly summaries: KeywordSummary[] = []) {
    super();
  }

  listTracked(): Promise<KeywordSummary[]> {
    return Promise.resolve(this.summaries);
  }
}

/**
 * Le contexte Keyword est le seul à écrire : c'est donc le seul où les codes
 * de statut portent une décision métier (201 / 204 / 400 / 404 / 409). Ces
 * tests montent la vraie chaîne HTTP, avec un dépôt en mémoire à la place de
 * Mongo.
 */
describe('Keyword — API', () => {
  let app: NestFastifyApplication;
  let repository: InMemoryKeywordRepository;

  async function start(initial: Record<string, boolean> = {}, summaries: KeywordSummary[] = []) {
    repository = new InMemoryKeywordRepository(initial);
    app = await createTestApp({
      controllers: [KeywordController],
      providers: [
        TrackKeywordCommand,
        UntrackKeywordCommand,
        ListKeywordSummariesQuery,
        { provide: KeywordRepository, useValue: repository },
        { provide: KeywordSummaryReadModel, useValue: new FakeKeywordSummaryReadModel(summaries) },
      ],
    });
  }

  afterEach(() => closeApp(app));

  describe('GET /api/v1/keywords', () => {
    it('renvoie les mots-clés suivis', async () => {
      await start({}, [
        { keyword: 'lessive', productCount: 42, lastScrape: '2026-08-08T06:00:00.000Z' },
        { keyword: 'café', productCount: 0, lastScrape: null },
      ]);

      const response = await app.inject({ method: 'GET', url: '/api/v1/keywords' });

      expect(response.statusCode).toBe(200);
      expect(jsonOf<KeywordSummary[]>(response)).toEqual([
        { keyword: 'lessive', productCount: 42, lastScrape: '2026-08-08T06:00:00.000Z' },
        { keyword: 'café', productCount: 0, lastScrape: null },
      ]);
    });
  });

  describe('POST /api/v1/keywords', () => {
    it('suit un nouveau mot-clé', async () => {
      await start();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/keywords',
        payload: { keyword: 'lessive liquide' },
      });

      expect(response.statusCode).toBe(201);
      expect(repository.stateOf('lessive liquide')).toBe(true);
    });

    it('réactive un mot-clé précédemment retiré', async () => {
      await start({ lessive: false });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/keywords',
        payload: { keyword: 'lessive' },
      });

      expect(response.statusCode).toBe(201);
      expect(repository.stateOf('lessive')).toBe(true);
    });

    it('refuse un mot-clé déjà suivi', async () => {
      await start({ lessive: true });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/keywords',
        payload: { keyword: 'lessive' },
      });

      expect(response.statusCode).toBe(409);
      expect(jsonOf<{ code: string }>(response).code).toBe('KEYWORD_ALREADY_TRACKED');
    });

    it('refuse un nom vide', async () => {
      await start();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/keywords',
        payload: { keyword: '   ' },
      });

      expect(response.statusCode).toBe(400);
      expect(jsonOf<{ code: string }>(response).code).toBe('INVALID_KEYWORD_NAME');
    });

    it('refuse un corps sans mot-clé', async () => {
      await start();

      // Validation de *forme* (le DTO), avant toute règle métier : la réponse
      // vient de la ValidationPipe, sans code domaine.
      const response = await app.inject({ method: 'POST', url: '/api/v1/keywords', payload: {} });

      expect(response.statusCode).toBe(400);
      expect(jsonOf<{ code?: string }>(response).code).toBeUndefined();
    });

    it('convertit un mot-clé numérique en chaîne au lieu de le refuser', async () => {
      await start();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/keywords',
        payload: { keyword: 42 },
      });

      // Conséquence de `transformOptions.enableImplicitConversion` : le 42 est
      // converti en « 42 » *avant* que `@IsString()` ne s'exécute, donc la
      // requête passe. Sans danger (KeywordName valide ensuite le contenu),
      // mais c'est le comportement réel — à changer sciemment si on le veut
      // strict, pas à découvrir en production.
      expect(response.statusCode).toBe(201);
      expect(repository.stateOf('42')).toBe(true);
    });

    it('ignore un champ surnuméraire en refusant la requête', async () => {
      await start();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/keywords',
        payload: { keyword: 'lessive', enabled: false },
      });

      expect(response.statusCode).toBe(400);
      expect(repository.stateOf('lessive')).toBeUndefined();
    });
  });

  describe('DELETE /api/v1/keywords/:keyword', () => {
    it('retire un mot-clé suivi', async () => {
      await start({ lessive: true });

      const response = await app.inject({ method: 'DELETE', url: '/api/v1/keywords/lessive' });

      expect(response.statusCode).toBe(204);
      expect(repository.stateOf('lessive')).toBe(false);
    });

    it('décode un mot-clé contenant un espace', async () => {
      await start({ 'lessive liquide': true });

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/keywords/lessive%20liquide',
      });

      expect(response.statusCode).toBe(204);
      expect(repository.stateOf('lessive liquide')).toBe(false);
    });

    it('retirer deux fois reste un succès', async () => {
      await start({ lessive: false });

      const response = await app.inject({ method: 'DELETE', url: '/api/v1/keywords/lessive' });

      expect(response.statusCode).toBe(204);
    });

    it('signale un mot-clé inconnu', async () => {
      await start();

      const response = await app.inject({ method: 'DELETE', url: '/api/v1/keywords/inexistant' });

      expect(response.statusCode).toBe(404);
      expect(jsonOf<{ code: string }>(response).code).toBe('KEYWORD_NOT_FOUND');
    });
  });
});

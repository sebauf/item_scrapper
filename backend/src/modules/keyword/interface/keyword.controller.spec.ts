import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { UserId } from 'src/shared/domain/user-id';
import { signInternalToken } from 'src/shared/infrastructure/auth/internal-token';
import { ALICE, BOB, authAs, closeApp, createTestApp, jsonOf } from 'src/testing/http';
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

/** Read model factice : des résumés par utilisateur, pour vérifier l'isolation. */
class FakeKeywordSummaryReadModel extends KeywordSummaryReadModel {
  constructor(private readonly byUser: Record<string, KeywordSummary[]> = {}) {
    super();
  }

  listTracked(owner: UserId): Promise<KeywordSummary[]> {
    return Promise.resolve(this.byUser[owner.value] ?? []);
  }

  listTrackedNames(owner: UserId): Promise<string[]> {
    return Promise.resolve((this.byUser[owner.value] ?? []).map((summary) => summary.keyword));
  }
}

/**
 * Le contexte Keyword écrit : c'est donc là que les codes de statut portent une
 * décision métier (201 / 204 / 400 / 404 / 409). Ces tests montent la vraie
 * chaîne HTTP — garde d'authentification comprise —, avec un dépôt en mémoire à
 * la place de Mongo.
 */
describe('Keyword — API', () => {
  let app: NestFastifyApplication;
  let repository: InMemoryKeywordRepository;

  async function start(
    initial: Record<string, string[]> = {},
    summaries: Record<string, KeywordSummary[]> = {},
  ) {
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

  describe('authentification', () => {
    it('refuse une requête sans jeton', async () => {
      await start();

      const response = await app.inject({ method: 'GET', url: '/api/v1/keywords' });

      expect(response.statusCode).toBe(401);
    });

    it('refuse un jeton signé avec un autre secret', async () => {
      await start();
      const forged = signInternalToken({ sub: 'alice@example.com', iss: 'pirate' }, 'x'.repeat(48));

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/keywords',
        headers: { authorization: `Bearer ${forged}` },
      });

      expect(response.statusCode).toBe(401);
    });

    it('n’écrit rien pour une requête refusée', async () => {
      await start();

      await app.inject({ method: 'POST', url: '/api/v1/keywords', payload: { keyword: 'lessive' } });

      expect(repository.subscribersOf('lessive')).toBeUndefined();
    });
  });

  describe('GET /api/v1/keywords', () => {
    it('renvoie les mots-clés de l’utilisateur authentifié, et seulement les siens', async () => {
      await start(
        {},
        {
          [ALICE.value]: [{ keyword: 'lessive', productCount: 42, lastScrape: '2026-08-08T06:00:00.000Z' }],
          [BOB.value]: [{ keyword: 'café', productCount: 0, lastScrape: null }],
        },
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/keywords',
        headers: authAs(ALICE),
      });

      expect(response.statusCode).toBe(200);
      expect(jsonOf<KeywordSummary[]>(response)).toEqual([
        { keyword: 'lessive', productCount: 42, lastScrape: '2026-08-08T06:00:00.000Z' },
      ]);
    });
  });

  describe('POST /api/v1/keywords', () => {
    async function post(payload: unknown, user: UserId = ALICE) {
      return app.inject({
        method: 'POST',
        url: '/api/v1/keywords',
        headers: authAs(user),
        payload: payload as object,
      });
    }

    it('suit un nouveau mot-clé au nom de l’utilisateur', async () => {
      await start();

      const response = await post({ keyword: 'lessive liquide' });

      expect(response.statusCode).toBe(201);
      expect(repository.subscribersOf('lessive liquide')).toEqual([ALICE.value]);
    });

    it('réactive un mot-clé précédemment retiré', async () => {
      await start({ lessive: [] });

      const response = await post({ keyword: 'lessive' });

      expect(response.statusCode).toBe(201);
      expect(repository.subscribersOf('lessive')).toEqual([ALICE.value]);
    });

    it('refuse un mot-clé déjà suivi par l’utilisateur', async () => {
      await start({ lessive: [ALICE.value] });

      const response = await post({ keyword: 'lessive' });

      expect(response.statusCode).toBe(409);
      expect(jsonOf<{ code: string }>(response).code).toBe('KEYWORD_ALREADY_TRACKED');
    });

    it('accepte qu’un second utilisateur suive le même mot-clé', async () => {
      await start({ lessive: [ALICE.value] });

      const response = await post({ keyword: 'lessive' }, BOB);

      expect(response.statusCode).toBe(201);
      expect(repository.subscribersOf('lessive')).toEqual([ALICE.value, BOB.value]);
    });

    it('refuse un nom vide', async () => {
      await start();

      const response = await post({ keyword: '   ' });

      expect(response.statusCode).toBe(400);
      expect(jsonOf<{ code: string }>(response).code).toBe('INVALID_KEYWORD_NAME');
    });

    it('refuse un corps sans mot-clé', async () => {
      await start();

      // Validation de *forme* (le DTO), avant toute règle métier : la réponse
      // vient de la ValidationPipe, sans code domaine.
      const response = await post({});

      expect(response.statusCode).toBe(400);
      expect(jsonOf<{ code?: string }>(response).code).toBeUndefined();
    });

    it('convertit un mot-clé numérique en chaîne au lieu de le refuser', async () => {
      await start();

      // Conséquence de `transformOptions.enableImplicitConversion` : le 42 est
      // converti en « 42 » *avant* que `@IsString()` ne s'exécute.
      const response = await post({ keyword: 42 });

      expect(response.statusCode).toBe(201);
      expect(repository.subscribersOf('42')).toEqual([ALICE.value]);
    });

    it('refuse un champ surnuméraire', async () => {
      await start();

      const response = await post({ keyword: 'lessive', enabled: false });

      expect(response.statusCode).toBe(400);
      expect(repository.subscribersOf('lessive')).toBeUndefined();
    });
  });

  describe('DELETE /api/v1/keywords/:keyword', () => {
    async function remove(path: string, user: UserId = ALICE) {
      return app.inject({ method: 'DELETE', url: `/api/v1/keywords/${path}`, headers: authAs(user) });
    }

    it('retire un mot-clé suivi', async () => {
      await start({ lessive: [ALICE.value] });

      const response = await remove('lessive');

      expect(response.statusCode).toBe(204);
      expect(repository.subscribersOf('lessive')).toEqual([]);
    });

    it('ne touche pas à l’abonnement des autres', async () => {
      await start({ lessive: [ALICE.value, BOB.value] });

      await remove('lessive', BOB);

      expect(repository.subscribersOf('lessive')).toEqual([ALICE.value]);
    });

    it('décode un mot-clé contenant un espace', async () => {
      await start({ 'lessive liquide': [ALICE.value] });

      const response = await remove('lessive%20liquide');

      expect(response.statusCode).toBe(204);
      expect(repository.subscribersOf('lessive liquide')).toEqual([]);
    });

    it('retirer deux fois reste un succès', async () => {
      await start({ lessive: [] });

      expect((await remove('lessive')).statusCode).toBe(204);
    });

    it('signale un mot-clé que personne n’a jamais suivi', async () => {
      await start();

      const response = await remove('inexistant');

      expect(response.statusCode).toBe(404);
      expect(jsonOf<{ code: string }>(response).code).toBe('KEYWORD_NOT_FOUND');
    });
  });
});

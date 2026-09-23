import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';

/**
 * Les Server Actions n'ont plus de logique métier : elles appellent l'API et
 * décident quoi faire de l'échec. C'est précisément cette décision qu'on teste
 * — afficher un message, ou laisser remonter — parce qu'elle détermine ce que
 * l'utilisateur voit quand quelque chose se passe mal.
 */
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    // ApiError reste la vraie classe : les actions font des `instanceof`.
    ApiError: actual.ApiError,
    trackKeyword: vi.fn(),
    untrackKeyword: vi.fn(),
    trackProductUrl: vi.fn(),
    untrackProductUrl: vi.fn(),
    addFavorite: vi.fn(),
    removeFavorite: vi.fn(),
    redeploy: vi.fn(),
  };
});

const api = await import('@/lib/api');
const { revalidatePath } = await import('next/cache');
const actions = await import('./actions');

function formData(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('addKeyword', () => {
  it('suit le mot-clé et rafraîchit les pages concernées', async () => {
    await expect(actions.addKeyword({}, formData({ keyword: 'lessive' }))).resolves.toEqual({
      success: true,
    });

    expect(api.trackKeyword).toHaveBeenCalledWith('lessive');
    expect(revalidatePath).toHaveBeenCalledWith('/');
    expect(revalidatePath).toHaveBeenCalledWith('/keywords');
  });

  it('remonte le message du backend sur un refus', async () => {
    // Le message vient du domaine backend : une seule formulation pour tous
    // les points d'entrée (API, MCP, frontend).
    vi.mocked(api.trackKeyword).mockRejectedValue(
      new ApiError(409, 'KEYWORD_ALREADY_TRACKED', 'Le mot-clé « lessive » est déjà suivi.'),
    );

    await expect(actions.addKeyword({}, formData({ keyword: 'lessive' }))).resolves.toEqual({
      error: 'Le mot-clé « lessive » est déjà suivi.',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('masque une panne serveur derrière un message générique', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(api.trackKeyword).mockRejectedValue(new ApiError(500, null, 'stack interne'));

    const result = await actions.addKeyword({}, formData({ keyword: 'lessive' }));

    expect(result.error).toBe('Le service est momentanément indisponible. Réessayez.');
    expect(result.error).not.toContain('stack interne');
  });

  it('traite une erreur inattendue comme une panne', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(api.trackKeyword).mockRejectedValue(new TypeError('fetch failed'));

    await expect(actions.addKeyword({}, formData({ keyword: 'lessive' }))).resolves.toMatchObject({
      error: expect.stringContaining('momentanément indisponible'),
    });
  });

  it('transmet une saisie vide au backend, seul juge de la validité', async () => {
    await actions.addKeyword({}, new FormData());

    expect(api.trackKeyword).toHaveBeenCalledWith('');
  });
});

describe('deleteKeyword', () => {
  it('retire le mot-clé et rafraîchit sa page', async () => {
    await actions.deleteKeyword('lessive liquide');

    expect(api.untrackKeyword).toHaveBeenCalledWith('lessive liquide');
    expect(revalidatePath).toHaveBeenCalledWith('/keyword/lessive%20liquide');
  });

  it('ne fait rien sur un nom vide', async () => {
    await actions.deleteKeyword('');

    expect(api.untrackKeyword).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('avale un 404 : l’état voulu est déjà atteint', async () => {
    vi.mocked(api.untrackKeyword).mockRejectedValue(new ApiError(404, 'KEYWORD_NOT_FOUND', 'inconnu'));

    await expect(actions.deleteKeyword('lessive')).resolves.toBeUndefined();
    expect(revalidatePath).toHaveBeenCalledWith('/keywords');
  });

  it('laisse remonter les autres échecs', async () => {
    vi.mocked(api.untrackKeyword).mockRejectedValue(new ApiError(500, null, 'boom'));

    await expect(actions.deleteKeyword('lessive')).rejects.toBeInstanceOf(ApiError);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('addTrackedUrl', () => {
  it('suit l’URL et rafraîchit la page de suivi', async () => {
    await expect(
      actions.addTrackedUrl({}, formData({ url: 'https://www.amazon.fr/dp/B0TEST0001/' })),
    ).resolves.toEqual({ success: true });

    expect(api.trackProductUrl).toHaveBeenCalledWith('https://www.amazon.fr/dp/B0TEST0001/');
    expect(revalidatePath).toHaveBeenCalledWith('/products');
  });

  it('remonte le refus du backend', async () => {
    vi.mocked(api.trackProductUrl).mockRejectedValue(
      new ApiError(400, 'INVALID_PRODUCT_URL', "l'URL ne pointe pas vers une fiche produit."),
    );

    await expect(actions.addTrackedUrl({}, formData({ url: 'https://exemple.fr' }))).resolves.toEqual({
      error: "l'URL ne pointe pas vers une fiche produit.",
    });
  });
});

describe('deleteTrackedUrl', () => {
  it('retire l’URL suivie', async () => {
    await actions.deleteTrackedUrl('aWQ');

    expect(api.untrackProductUrl).toHaveBeenCalledWith('aWQ');
    expect(revalidatePath).toHaveBeenCalledWith('/products');
  });

  it('ne fait rien sur un identifiant vide', async () => {
    await actions.deleteTrackedUrl('');

    expect(api.untrackProductUrl).not.toHaveBeenCalled();
  });

  it('avale un 404', async () => {
    vi.mocked(api.untrackProductUrl).mockRejectedValue(new ApiError(404, 'X', 'inconnu'));

    await expect(actions.deleteTrackedUrl('aWQ')).resolves.toBeUndefined();
  });
});

describe('favoris', () => {
  it('ajoute et rafraîchit les trois pages qui l’affichent', async () => {
    await actions.addFavoriteAction('aWQ');

    expect(api.addFavorite).toHaveBeenCalledWith('aWQ');
    expect(vi.mocked(revalidatePath).mock.calls.flat()).toEqual([
      '/favorites',
      '/product/aWQ',
      '/products',
    ]);
  });

  it('retire et rafraîchit les mêmes pages', async () => {
    await actions.removeFavoriteAction('aWQ');

    expect(api.removeFavorite).toHaveBeenCalledWith('aWQ');
    expect(vi.mocked(revalidatePath).mock.calls.flat()).toContain('/favorites');
  });

  it('ne fait rien sur un identifiant vide', async () => {
    await actions.addFavoriteAction('');
    await actions.removeFavoriteAction('');

    expect(api.addFavorite).not.toHaveBeenCalled();
    expect(api.removeFavorite).not.toHaveBeenCalled();
  });

  it('laisse remonter l’échec — le bouton étoile doit pouvoir revenir en arrière', async () => {
    // FavoriteButton est optimiste : il compte sur le rejet pour annuler
    // l'affichage. Avaler l'erreur ici laisserait une étoile mensongère.
    vi.mocked(api.addFavorite).mockRejectedValue(new ApiError(500, null, 'boom'));

    await expect(actions.addFavoriteAction('aWQ')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('redeployAction', () => {
  it('lance la mise à jour avec le jeton saisi et rafraîchit la page Système', async () => {
    vi.mocked(api.redeploy).mockResolvedValue(['price-tracker-backend']);

    await expect(actions.redeployAction({}, formData({ token: '  mon-jeton  ' }))).resolves.toEqual({
      restarted: ['price-tracker-backend'],
    });
    expect(api.redeploy).toHaveBeenCalledWith('mon-jeton');
    expect(revalidatePath).toHaveBeenCalledWith('/system');
  });

  it('n’appelle pas le backend sans jeton', async () => {
    await expect(actions.redeployAction({}, formData({ token: '   ' }))).resolves.toEqual({
      error: 'Saisissez le jeton administrateur.',
    });
    expect(api.redeploy).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'INVALID_ADMIN_TOKEN', 'Jeton administrateur invalide.'],
    [409, 'ALREADY_UP_TO_DATE', 'L’application est déjà à jour.'],
  ])('affiche le message du backend sur un refus %i', async (status, code, message) => {
    vi.mocked(api.redeploy).mockRejectedValue(new ApiError(status, code, message));

    await expect(actions.redeployAction({}, formData({ token: 't' }))).resolves.toEqual({ error: message });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('masque une panne derrière un message générique, sans journaliser le jeton', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(api.redeploy).mockRejectedValue(new ApiError(502, null, 'Bad gateway'));

    await expect(actions.redeployAction({}, formData({ token: 'secret-jeton' }))).resolves.toEqual({
      error: 'Le service est momentanément indisponible. Réessayez.',
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('secret-jeton');
  });
});

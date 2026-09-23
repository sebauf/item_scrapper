'use server';
import { revalidatePath } from 'next/cache';
import {
  addFavorite,
  ApiError,
  redeploy,
  removeFavorite,
  trackKeyword,
  trackProductUrl,
  untrackKeyword,
  untrackProductUrl,
} from '@/lib/api';

/**
 * Server Actions — elles n'écrivent plus en base, elles appellent l'API.
 *
 * Les messages d'erreur affichés à l'utilisateur viennent désormais du backend
 * (`catalog`/`keyword` domain errors), ce qui évite d'avoir deux formulations
 * différentes pour la même règle selon le point d'entrée.
 */

export async function addKeyword(
  _prev: { error?: string; success?: boolean },
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const raw = formData.get('keyword');
  const keyword = typeof raw === 'string' ? raw : '';

  try {
    await trackKeyword(keyword);
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return { error: error.message };
    console.error('addKeyword', error);
    return { error: 'Le service est momentanément indisponible. Réessayez.' };
  }

  revalidatePath('/');
  revalidatePath('/keywords');
  return { success: true };
}

export async function deleteKeyword(keyword: string): Promise<void> {
  if (!keyword) return;

  try {
    await untrackKeyword(keyword);
  } catch (error) {
    // Un mot-clé déjà absent n'est pas un échec du point de vue de l'utilisateur :
    // l'état voulu est atteint. Le reste doit remonter.
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  }

  revalidatePath('/');
  revalidatePath('/keywords');
  revalidatePath(`/keyword/${encodeURIComponent(keyword)}`);
}

export async function addTrackedUrl(
  _prev: { error?: string; success?: boolean },
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const raw = formData.get('url');
  const url = typeof raw === 'string' ? raw : '';

  try {
    await trackProductUrl(url);
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return { error: error.message };
    console.error('addTrackedUrl', error);
    return { error: 'Le service est momentanément indisponible. Réessayez.' };
  }

  revalidatePath('/products');
  return { success: true };
}

export async function deleteTrackedUrl(id: string): Promise<void> {
  if (!id) return;

  try {
    await untrackProductUrl(id);
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  }

  revalidatePath('/products');
}

export async function addFavoriteAction(id: string): Promise<void> {
  if (!id) return;
  await addFavorite(id);
  revalidatePath('/favorites');
  revalidatePath(`/product/${id}`);
  revalidatePath('/products');
}

export async function removeFavoriteAction(id: string): Promise<void> {
  if (!id) return;
  await removeFavorite(id);
  revalidatePath('/favorites');
  revalidatePath(`/product/${id}`);
  revalidatePath('/products');
}

export interface RedeployState {
  error?: string;
  restarted?: string[];
}

/**
 * Le jeton n'est ni stocké ni journalisé : il transite du formulaire au
 * backend, qui seul le vérifie. Les refus (401 jeton faux, 409 déjà à jour ou
 * rollout en cours) arrivent avec un message du backend, affiché tel quel.
 */
export async function redeployAction(
  _prev: RedeployState,
  formData: FormData,
): Promise<RedeployState> {
  const raw = formData.get('token');
  const token = typeof raw === 'string' ? raw.trim() : '';
  if (!token) return { error: 'Saisissez le jeton administrateur.' };

  let restarted: string[];
  try {
    restarted = await redeploy(token);
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return { error: error.message };
    console.error('redeployAction', error instanceof Error ? error.message : error);
    return { error: 'Le service est momentanément indisponible. Réessayez.' };
  }

  revalidatePath('/system');
  return { restarted };
}

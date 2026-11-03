'use server';
import { revalidatePath } from 'next/cache';
import {
  addFavorite,
  addFavoriteStation,
  ApiError,
  removeFavorite,
  removeFavoriteStation,
  trackKeyword,
  trackProductUrl,
  untrackKeyword,
  untrackProductUrl,
  updateProfile,
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

/**
 * Un refus métier (quota d'URLs suivies atteint, identifiant invalide) est
 * **renvoyé** avec son message plutôt que levé : en production, Next masque le
 * message d'une erreur levée par une Server Action, et le bouton étoile ne
 * pourrait qu'annuler en silence. Une panne (5xx, réseau) est toujours levée.
 */
export async function addFavoriteAction(id: string): Promise<{ error?: string }> {
  if (!id) return {};
  try {
    await addFavorite(id);
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return { error: error.message };
    throw error;
  }
  revalidatePath('/favorites');
  revalidatePath(`/product/${id}`);
  revalidatePath('/products');
  return {};
}

export async function removeFavoriteAction(id: string): Promise<void> {
  if (!id) return;
  await removeFavorite(id);
  revalidatePath('/favorites');
  revalidatePath(`/product/${id}`);
  revalidatePath('/products');
}

/**
 * Stations favorites — ce sont elles que surveille l'alerte de
 * réapprovisionnement du pipeline. Les erreurs remontent : le bouton étoile
 * annule alors son bascule optimiste.
 */
export async function addFavoriteStationAction(stationId: string): Promise<void> {
  if (!stationId) return;
  await addFavoriteStation(stationId);
  revalidatePath('/fuel');
}

export async function removeFavoriteStationAction(stationId: string): Promise<void> {
  if (!stationId) return;
  await removeFavoriteStation(stationId);
  revalidatePath('/fuel');
}

export interface ProfileFormState {
  error?: string;
  success?: boolean;
}

/**
 * Enregistre le profil (numéro + carburants surveillés). Comme pour les
 * autres formulaires, un refus du backend (numéro mal formé…) est renvoyé
 * avec son message, une panne est signalée sans détail.
 */
export async function saveProfileAction(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const raw = formData.get('phone');
  const phone = typeof raw === 'string' && raw.trim() !== '' ? raw : null;
  const alertFuels = formData.getAll('alertFuels').filter((v): v is string => typeof v === 'string');

  try {
    await updateProfile({ phone, alertFuels });
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return { error: error.message };
    console.error('saveProfileAction', error);
    return { error: 'Le service est momentanément indisponible. Réessayez.' };
  }

  revalidatePath('/profile');
  return { success: true };
}

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
 * Server Actions : chaque mutation appelle l'API du backend, puis rafraîchit
 * les pages qui affichent ce qu'elle a changé.
 *
 * Les messages de refus viennent du backend (erreurs métier de chaque
 * module) : une même règle n'a qu'une formulation, que l'on passe par le
 * frontend ou par le serveur MCP.
 */

/** État d'un formulaire branché sur `useActionState`. */
export interface FormState {
  error?: string;
  success?: boolean;
}

const UNAVAILABLE_MESSAGE = 'Le service est momentanément indisponible. Réessayez.';

export async function addKeyword(_prev: FormState, formData: FormData): Promise<FormState> {
  const keyword = textField(formData, 'keyword');
  return submitForm('addKeyword', () => trackKeyword(keyword), () => {
    revalidatePath('/');
    revalidatePath('/keywords');
  });
}

export async function deleteKeyword(keyword: string): Promise<void> {
  if (!keyword) return;
  await ignoreNotFound(() => untrackKeyword(keyword));
  revalidatePath('/');
  revalidatePath('/keywords');
  revalidatePath(`/keyword/${encodeURIComponent(keyword)}`);
}

export async function addTrackedUrl(_prev: FormState, formData: FormData): Promise<FormState> {
  const url = textField(formData, 'url');
  return submitForm('addTrackedUrl', () => trackProductUrl(url), () => revalidatePath('/products'));
}

export async function deleteTrackedUrl(id: string): Promise<void> {
  if (!id) return;
  await ignoreNotFound(() => untrackProductUrl(id));
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
    if (isRefusal(error)) return { error: error.message };
    throw error;
  }
  revalidateFavoritePages(id);
  return {};
}

export async function removeFavoriteAction(id: string): Promise<void> {
  if (!id) return;
  await removeFavorite(id);
  revalidateFavoritePages(id);
}

/**
 * Stations favorites — ce sont elles que surveillent les alertes carburant du
 * pipeline. Les erreurs remontent : le bouton étoile annule alors sa bascule
 * optimiste.
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

/** Enregistre le profil : numéro (vide = effacé) et carburants surveillés. */
export async function saveProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = formData.get('phone');
  const phone = typeof raw === 'string' && raw.trim() !== '' ? raw : null;
  const alertFuels = formData.getAll('alertFuels').filter((v): v is string => typeof v === 'string');
  return submitForm('saveProfileAction', () => updateProfile({ phone, alertFuels }), () =>
    revalidatePath('/profile'),
  );
}

/**
 * Exécute la mutation d'un formulaire. Un refus du backend (4xx) est renvoyé
 * avec son message ; une panne est journalisée et signalée sans détail — ni
 * trace interne, ni message technique à l'écran.
 */
async function submitForm(
  label: string,
  mutate: () => Promise<unknown>,
  revalidate: () => void,
): Promise<FormState> {
  try {
    await mutate();
  } catch (error) {
    if (isRefusal(error)) return { error: error.message };
    console.error(label, error);
    return { error: UNAVAILABLE_MESSAGE };
  }
  revalidate();
  return { success: true };
}

/** Une réponse 4xx : le backend refuse la demande, il n'est pas en panne. */
function isRefusal(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status < 500;
}

/**
 * Retirer ce qui est déjà absent n'est pas un échec du point de vue de
 * l'utilisateur : l'état voulu est atteint. Le reste remonte.
 */
async function ignoreNotFound(call: () => Promise<void>): Promise<void> {
  try {
    await call();
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  }
}

/** Un favori s'affiche sur sa fiche, dans la liste des favoris et dans celle des produits suivis. */
function revalidateFavoritePages(id: string): void {
  revalidatePath('/favorites');
  revalidatePath(`/product/${id}`);
  revalidatePath('/products');
}

/** Valeur texte d'un champ ; `''` si absent — le backend reste seul juge de la validité. */
function textField(formData: FormData, name: string): string {
  const raw = formData.get(name);
  return typeof raw === 'string' ? raw : '';
}

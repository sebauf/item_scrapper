'use server';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/mongodb';

export async function addKeyword(
  _prev: { error?: string; success?: boolean },
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const raw = formData.get('keyword');
  const keyword = typeof raw === 'string' ? raw.trim() : '';

  if (!keyword) return { error: 'Le mot-clé ne peut pas être vide.' };
  if (keyword.length > 100) return { error: 'Trop long (max 100 caractères).' };

  const db = await getDb();
  const existing = await db.collection('keywords').findOne({ keyword });

  if (existing) {
    if (existing.enabled === false) {
      await db.collection('keywords').updateOne({ keyword }, { $set: { enabled: true } });
    } else {
      return { error: 'Ce mot-clé est déjà suivi.' };
    }
  } else {
    await db.collection('keywords').insertOne({ keyword, enabled: true });
  }

  revalidatePath('/');
  return { success: true };
}

export async function deleteKeyword(keyword: string): Promise<void> {
  if (!keyword) return;
  const db = await getDb();
  await db.collection('keywords').updateOne({ keyword }, { $set: { enabled: false } });
  revalidatePath('/');
  revalidatePath(`/keyword/${encodeURIComponent(keyword)}`);
}

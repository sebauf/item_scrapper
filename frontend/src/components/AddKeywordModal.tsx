'use client';
import { addKeyword } from '@/app/actions';
import { AddItemModal } from './AddItemModal';

export function AddKeywordModal({ onClose }: { onClose: () => void }) {
  return (
    <AddItemModal
      action={addKeyword}
      title="Ajouter un mot-clé"
      hint="Sera scrapé lors du prochain run Airflow."
      field={{ name: 'keyword', type: 'text', placeholder: 'ex: iphone 16 pro, aspirateur dyson…' }}
      submitLabel="Ajouter"
      onClose={onClose}
    />
  );
}

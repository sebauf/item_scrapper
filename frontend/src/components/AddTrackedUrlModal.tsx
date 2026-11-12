'use client';
import { addTrackedUrl } from '@/app/actions';
import { AddItemModal } from './AddItemModal';

export function AddTrackedUrlModal({ onClose }: { onClose: () => void }) {
  return (
    <AddItemModal
      action={addTrackedUrl}
      title="Suivre une URL produit"
      hint="Fiche produit amazon.fr uniquement. Sera scrapée lors du prochain run Airflow."
      field={{ name: 'url', type: 'url', placeholder: 'https://www.amazon.fr/dp/B0XXXXXXXX/' }}
      submitLabel="Suivre"
      onClose={onClose}
    />
  );
}

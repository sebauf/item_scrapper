'use client';
import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Confirmation d'une action destructrice, en feuille sur mobile et en modale
 * au-dessus de `sm`.
 *
 * Le confirmateur en ligne qu'elle remplace tenait dans la largeur d'une ligne
 * de liste : deux liens « Oui / Non » de 12px collés l'un à l'autre, hors de
 * portée d'un pouce. Ici les deux boutons occupent toute la largeur et une
 * hauteur de cible tactile, et l'action destructrice est la seconde — sous le
 * pouce mais pas là où il retombe par réflexe.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel = 'Supprimer',
  pendingLabel = 'Suppression…',
  pending = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  pendingLabel?: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Le focus part sur « Annuler » : sur un dialogue destructeur, la touche
  // Entrée réflexe doit renoncer, pas supprimer.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 pb-20 sm:pb-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="relative bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-md p-6 animate-[slideUp_0.2s_ease]"
      >
        <h2 id="confirm-dialog-title" className="text-lg font-semibold text-foreground">
          {title}
        </h2>
        {description && <p className="text-sm text-muted mt-1.5">{description}</p>}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-6">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="px-5 min-h-12 sm:min-h-0 sm:py-2.5 text-sm font-medium text-muted hover:text-foreground rounded-xl border border-border hover:bg-surface-hover transition-colors"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="px-5 min-h-12 sm:min-h-0 sm:py-2.5 text-sm font-semibold bg-danger text-on-danger rounded-xl hover:opacity-90 disabled:opacity-60 transition-opacity shadow-sm"
          >
            {pending ? pendingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

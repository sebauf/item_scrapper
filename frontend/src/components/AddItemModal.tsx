'use client';
import { useActionState, useEffect, useRef } from 'react';
import type { FormState } from '@/app/actions';

export interface AddItemModalProps {
  /** Server Action du formulaire. */
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  title: string;
  hint: string;
  /** Le champ unique du formulaire, tel que la Server Action le lit. */
  field: { name: string; type: 'text' | 'url'; placeholder: string };
  submitLabel: string;
  onClose: () => void;
}

/**
 * Modale d'ajout à un champ (mot-clé, URL suivie) : focus sur le champ à
 * l'ouverture, fermeture sur Échap, sur le fond ou après un ajout réussi, et
 * message de refus du backend affiché sous le champ.
 */
export function AddItemModal({ action, title, hint, field, submitLabel, onClose }: AddItemModalProps) {
  const [state, formAction, pending] = useActionState(action, {});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (state?.success) onClose();
  }, [state?.success, onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 pb-20 sm:pb-4">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-surface rounded-2xl shadow-2xl w-full max-w-md p-6 animate-[slideUp_0.2s_ease]">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            <p className="text-sm text-muted mt-0.5">{hint}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="text-faint hover:text-muted transition-colors p-1 -mr-1 -mt-1"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form action={formAction} className="flex flex-col gap-3">
          {/* text-base sous sm : en dessous de 16px, iOS zoome sur le champ au focus */}
          <input
            ref={inputRef}
            name={field.name}
            type={field.type}
            placeholder={field.placeholder}
            className="w-full px-4 py-3 rounded-xl border border-border bg-surface focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft text-base sm:text-sm transition-shadow"
            required
          />
          {state?.error && (
            <p className="text-sm text-danger bg-danger-soft px-3 py-2 rounded-lg">
              {state.error}
            </p>
          )}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 min-h-12 sm:min-h-0 sm:py-2.5 text-sm font-medium text-muted hover:text-foreground rounded-xl border border-border sm:border-transparent hover:bg-surface-hover transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={pending}
              className="px-5 min-h-12 sm:min-h-0 sm:py-2.5 text-sm font-semibold bg-accent text-on-accent rounded-xl hover:bg-accent-hover disabled:opacity-60 transition-colors shadow-sm"
            >
              {pending ? 'Ajout…' : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

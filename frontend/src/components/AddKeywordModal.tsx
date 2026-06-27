'use client';
import { useActionState, useEffect, useRef } from 'react';
import { addKeyword } from '@/app/actions';

export function AddKeywordModal({ onClose }: { onClose: () => void }) {
  const [state, action, pending] = useActionState(addKeyword, {});
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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-[slideUp_0.2s_ease]">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Ajouter un mot-clé</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Sera scrapé lors du prochain run Airflow.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors p-1 -mr-1 -mt-1"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form action={action} className="flex flex-col gap-3">
          <input
            ref={inputRef}
            name="keyword"
            type="text"
            placeholder="ex: iphone 16 pro, aspirateur dyson…"
            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 text-sm transition-shadow"
            required
          />
          {state?.error && (
            <p className="text-sm text-rose-600 bg-rose-50 px-3 py-2 rounded-lg">
              {state.error}
            </p>
          )}
          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-sm text-gray-600 hover:text-gray-800 rounded-xl hover:bg-gray-100 transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={pending}
              className="px-5 py-2.5 text-sm font-semibold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-60 transition-colors shadow-sm"
            >
              {pending ? 'Ajout…' : 'Ajouter'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

'use client';

import Link from 'next/link';

export default function KeywordError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="max-w-6xl mx-auto px-4 py-10">
      <Link href="/" className="text-sm text-gray-500 hover:text-gray-700 mb-6 inline-block">
        ← Retour
      </Link>
      <p className="text-gray-600">
        Une erreur est survenue en affichant ces produits.{' '}
        <button onClick={reset} className="underline hover:text-gray-900">
          Réessayer
        </button>
      </p>
    </main>
  );
}

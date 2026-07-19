'use client';

import Link from 'next/link';

export default function ProductError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="max-w-6xl mx-auto px-4 py-10">
      <Link href="/" className="text-sm text-muted hover:text-foreground mb-6 inline-block">
        ← Retour
      </Link>
      <p className="text-muted">
        Une erreur est survenue en affichant ce produit.{' '}
        <button onClick={reset} className="underline hover:text-foreground">
          Réessayer
        </button>
      </p>
    </main>
  );
}

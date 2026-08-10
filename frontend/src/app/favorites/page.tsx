import Link from 'next/link';
import { getFavorites } from '@/lib/api';
import { FavoriteCard } from '@/components/FavoriteCard';

export const dynamic = 'force-dynamic';

export default async function FavoritesPage() {
  const favorites = await getFavorites();

  return (
    <main className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Favoris</h1>
        <p className="text-sm text-muted mt-1">
          {favorites.length} produit{favorites.length !== 1 ? 's' : ''} favori
          {favorites.length !== 1 ? 's' : ''} · Évolution du prix
        </p>
      </div>

      {favorites.length === 0 ? (
        <div className="text-center py-16 bg-surface rounded-2xl border border-dashed border-border">
          <p className="text-4xl mb-3">⭐</p>
          <p className="text-muted font-medium">Aucun favori pour l&apos;instant.</p>
          <p className="text-sm text-faint mt-1">
            Ouvrez une fiche produit et cliquez sur « Favoris » pour suivre son évolution ici.
          </p>
          <Link
            href="/keywords"
            className="inline-block mt-5 px-4 py-2 bg-accent text-on-accent text-sm font-semibold rounded-xl hover:bg-accent-hover transition-colors"
          >
            Parcourir les produits
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {favorites.map((product) => (
            <FavoriteCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </main>
  );
}

import Link from 'next/link';
import { getDashboard, type KeywordDeals } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { ProductCard } from '@/components/ProductCard';
import { StatCard } from '@/components/StatCard';

export const dynamic = 'force-dynamic';

function KeywordDealsSection({ keyword, deals, totalDeals, productCount }: KeywordDeals) {
  return (
    <div className="bg-surface rounded-2xl border border-border overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-base">🔥</span>
          <h3 className="font-semibold text-foreground truncate capitalize">{keyword}</h3>
          <span className="shrink-0 text-xs font-medium text-deal bg-deal-soft border border-deal-border px-2 py-0.5 rounded-full">
            {totalDeals} affaire{totalDeals > 1 ? 's' : ''}
          </span>
          <span className="hidden sm:inline shrink-0 text-xs text-faint">
            sur {productCount} produit{productCount > 1 ? 's' : ''}
          </span>
        </div>
        <Link
          href={`/keyword/${encodeURIComponent(keyword)}?deals=1`}
          className="shrink-0 text-sm text-accent hover:text-accent-hover hover:underline transition-colors ml-4"
        >
          Voir tous →
        </Link>
      </div>

      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {deals.map((product) => (
          <ProductCard key={product.url} product={product} />
        ))}
      </div>
    </div>
  );
}

function QuietKeywordsCard({ groups }: { groups: KeywordDeals[] }) {
  return (
    <div className="bg-surface rounded-2xl border border-border-subtle px-5 py-4">
      <div className="flex items-center gap-2.5 mb-3">
        <span className="text-base">📦</span>
        <h3 className="font-semibold text-foreground">Aucune affaire aujourd&apos;hui</h3>
        <span className="text-xs text-faint">prix au-dessus de la moyenne historique</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {groups.map((g) => (
          <Link
            key={g.keyword}
            href={`/keyword/${encodeURIComponent(g.keyword)}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border text-sm text-muted capitalize hover:border-accent/40 hover:text-accent hover:bg-accent-soft/40 transition-colors"
          >
            {g.keyword}
            <span className="text-xs text-faint">{g.productCount}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default async function DashboardPage() {
  const { keywordCount, productCount, dealCount, lastUpdate, dealsByKeyword } =
    await getDashboard();

  const withDeals = dealsByKeyword.filter((g) => g.totalDeals > 0);
  const withoutDeals = dealsByKeyword.filter((g) => g.totalDeals === 0);

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Tableau de bord</h1>
        {lastUpdate && (
          <p className="text-sm text-faint mt-1">Mis à jour {timeAgo(lastUpdate)}</p>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-10">
        <StatCard value={keywordCount} label="Mots-clés suivis" icon="🔑" />
        <StatCard value={productCount} label="Produits trackés" icon="📦" />
        <StatCard
          value={dealCount}
          label="Bonnes affaires"
          icon="🔥"
          accent={dealCount > 0 ? 'text-deal' : 'text-foreground'}
        />
        <StatCard
          value={lastUpdate ? new Date(lastUpdate).toLocaleDateString('fr-FR') : '—'}
          label="Dernier pipeline"
          icon="🕐"
        />
      </div>

      {dealsByKeyword.length > 0 ? (
        <section className="flex flex-col gap-6">
          <h2 className="text-lg font-bold text-foreground">Bonnes affaires du jour</h2>
          {withDeals.map((group) => (
            <KeywordDealsSection key={group.keyword} {...group} />
          ))}
          {withDeals.length === 0 && (
            <p className="text-sm text-faint -mt-3">
              Aucune bonne affaire détectée aujourd&apos;hui — les prix sont au-dessus de leur
              moyenne historique.
            </p>
          )}
          {withoutDeals.length > 0 && <QuietKeywordsCard groups={withoutDeals} />}
        </section>
      ) : (
        <section className="text-center py-16 bg-surface rounded-2xl border border-dashed border-border">
          <p className="text-4xl mb-3">📊</p>
          <p className="text-muted font-medium">Aucune bonne affaire détectée pour l&apos;instant.</p>
          <p className="text-sm text-faint mt-1">
            Le pipeline de scoring doit tourner au moins une fois.
          </p>
          <Link
            href="/keywords"
            className="inline-block mt-5 px-4 py-2 bg-accent text-on-accent text-sm font-semibold rounded-xl hover:bg-accent-hover transition-colors"
          >
            Gérer les mots-clés
          </Link>
        </section>
      )}
    </main>
  );
}

import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { cache } from 'react';
import { getProduct, type ProductDetail } from '@/lib/api';
import { formatPrice } from '@/lib/format';
import { PriceChart, type PricePoint } from '@/components/PriceChart';
import { TrendBadge } from '@/components/ProductCard';

export const dynamic = 'force-dynamic';

// La page et generateMetadata demandent le même produit : cache() déduplique
// l'appel réseau le temps du rendu (l'ancien code déduplique déjà la requête
// Mongo de la même façon).
const loadProduct = cache(getProduct);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const detail = await loadProduct(id);
  return { title: detail?.title ? `${detail.title} – Price Tracker` : 'Produit – Price Tracker' };
}

function discountPct(price: number, crossed: number): number {
  return Math.round((1 - price / crossed) * 100);
}

function historyStats(detail: ProductDetail) {
  const amounts = detail.history
    .map((e) => e.price?.amount)
    .filter((a): a is number => typeof a === 'number');
  if (amounts.length === 0) return null;
  return {
    min: Math.min(...amounts),
    max: Math.max(...amounts),
    avg: amounts.reduce((s, a) => s + a, 0) / amounts.length,
    count: amounts.length,
  };
}

function HistoryTable({ detail, currency }: { detail: ProductDetail; currency: string }) {
  // Most recent first; delta compares each entry to the chronologically previous one
  const entries = [...detail.history].reverse().slice(0, 15);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-faint border-b border-border-subtle">
            <th className="py-2 pr-4 font-medium">Date</th>
            <th className="py-2 pr-4 font-medium">Prix</th>
            <th className="py-2 pr-4 font-medium hidden sm:table-cell">Prix barré</th>
            <th className="py-2 font-medium">Évolution</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, i) => {
            const prev = entries[i + 1];
            const delta =
              entry.price && prev?.price ? entry.price.amount - prev.price.amount : null;
            return (
              <tr key={entry.day} className="border-b border-border-subtle last:border-0">
                <td className="py-2.5 pr-4 text-muted whitespace-nowrap">
                  {new Date(entry.day).toLocaleDateString('fr-FR')}
                </td>
                <td className={`py-2.5 pr-4 font-semibold whitespace-nowrap ${i === 0 ? 'text-foreground' : 'text-muted'}`}>
                  {entry.price ? formatPrice(entry.price.amount, entry.price.currency) : '—'}
                </td>
                <td className="py-2.5 pr-4 text-faint line-through whitespace-nowrap hidden sm:table-cell">
                  {entry.crossedOutPrice
                    ? formatPrice(entry.crossedOutPrice.amount, entry.crossedOutPrice.currency)
                    : ''}
                </td>
                <td className="py-2.5 whitespace-nowrap">
                  {delta !== null && delta !== 0 ? (
                    <span className={`text-xs font-semibold ${delta < 0 ? 'text-deal' : 'text-danger'}`}>
                      {delta < 0 ? '↓' : '↑'} {formatPrice(Math.abs(delta), currency)}
                    </span>
                  ) : delta === 0 ? (
                    <span className="text-xs text-ghost">–</span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await loadProduct(id);
  if (!detail) notFound();

  const currency = detail.price?.currency ?? detail.history.find((e) => e.price)?.price?.currency ?? 'EUR';
  const hasDeal = detail.isDeal;
  const stats = historyStats(detail);

  const chartData: PricePoint[] = detail.history.map((entry) => ({
    day: entry.day,
    price: entry.price?.amount ?? null,
    crossedOut: entry.crossedOutPrice?.amount ?? null,
  }));
  const chartablePoints = chartData.filter((d) => d.price !== null).length;

  return (
    <main className="max-w-6xl mx-auto px-4 py-6">
      {detail.keyword && (
        <Link
          href={`/keyword/${encodeURIComponent(detail.keyword)}`}
          className="inline-flex items-center gap-1 text-sm text-faint hover:text-foreground transition-colors mb-5 capitalize"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          {detail.keyword}
        </Link>
      )}

      {/* Product header: image + infos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-surface rounded-2xl border border-border overflow-hidden">
          <div className="relative h-72 sm:h-96 bg-image-bg">
            {detail.images[0] ? (
              <Image
                src={detail.images[0]}
                alt={detail.title}
                fill
                className="object-contain p-6"
                sizes="(max-width: 1024px) 100vw, 50vw"
                priority
              />
            ) : (
              <div className="h-full flex items-center justify-center text-ghost">
                <svg className="w-20 h-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
            )}
            {hasDeal && detail.dealScore !== null && (
              <div className="absolute top-3 left-3 bg-deal-strong text-white text-sm font-bold px-3 py-1.5 rounded-lg shadow-sm">
                🔥 −{Math.round(detail.dealScore)}%
              </div>
            )}
          </div>
          {detail.images.length > 1 && (
            <div className="flex gap-2 p-3 overflow-x-auto border-t border-border-subtle bg-surface">
              {detail.images.slice(1, 6).map((img) => (
                <div key={img} className="relative w-16 h-16 shrink-0 rounded-lg bg-image-bg overflow-hidden border border-border-subtle">
                  <Image src={img} alt="" fill className="object-contain p-1" sizes="64px" />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-bold text-foreground leading-snug flex-1 min-w-0">
              {detail.title}
            </h1>
            {detail.trendDirection && detail.trendDirection !== 'stable' && (
              <TrendBadge trend={detail.trendDirection} />
            )}
          </div>

          <div className="flex items-baseline gap-3 flex-wrap">
            {detail.price && (
              <span className="text-3xl sm:text-4xl font-bold text-foreground">
                {formatPrice(detail.price.amount, detail.price.currency)}
              </span>
            )}
            {detail.crossedOutPrice && detail.price && (
              <>
                <span className="text-lg text-faint line-through">
                  {formatPrice(detail.crossedOutPrice.amount, detail.crossedOutPrice.currency)}
                </span>
                <span className="text-sm font-semibold text-danger bg-danger-soft px-2 py-0.5 rounded-lg">
                  −{discountPct(detail.price.amount, detail.crossedOutPrice.amount)}%
                </span>
              </>
            )}
          </div>

          <div className="flex flex-col gap-1.5 text-sm text-muted">
            {detail.unitPrice && detail.price && (
              <p>
                {formatPrice(detail.unitPrice.amount, currency)}/{detail.unitPrice.unit}
              </p>
            )}
            {detail.predictedPrice !== null && (
              <p>
                Prix attendu :{' '}
                <span className="font-semibold text-foreground">
                  {formatPrice(detail.predictedPrice, currency)}
                </span>{' '}
                <span className="text-xs text-faint">(moyenne 30 jours)</span>
              </p>
            )}
            {detail.deliveryDate && <p>📦 {detail.deliveryDate}</p>}
          </div>

          <a
            href={detail.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-accent text-on-accent font-semibold rounded-xl hover:bg-accent-hover transition-colors shadow-sm mt-1 self-start"
          >
            Voir sur Amazon
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>

          {stats && (
            <div className="grid grid-cols-3 gap-3 mt-2">
              <div className="bg-surface rounded-xl border border-border px-3 py-2.5">
                <p className="text-xs text-faint">Min</p>
                <p className="text-sm sm:text-base font-bold text-deal truncate">
                  {formatPrice(stats.min, currency)}
                </p>
              </div>
              <div className="bg-surface rounded-xl border border-border px-3 py-2.5">
                <p className="text-xs text-faint">Moyenne</p>
                <p className="text-sm sm:text-base font-bold text-foreground truncate">
                  {formatPrice(stats.avg, currency)}
                </p>
              </div>
              <div className="bg-surface rounded-xl border border-border px-3 py-2.5">
                <p className="text-xs text-faint">Max</p>
                <p className="text-sm sm:text-base font-bold text-foreground truncate">
                  {formatPrice(stats.max, currency)}
                </p>
              </div>
            </div>
          )}

          {detail.firstSeen && (
            <p className="text-xs text-faint">
              Suivi depuis le {new Date(detail.firstSeen).toLocaleDateString('fr-FR')}
              {stats && <> · {stats.count} relevé{stats.count > 1 ? 's' : ''}</>}
            </p>
          )}
        </div>
      </div>

      {/* Price evolution chart */}
      <section className="bg-surface rounded-2xl border border-border p-5 mb-6">
        <h2 className="font-semibold text-foreground mb-4">Évolution du prix</h2>
        {chartablePoints >= 2 ? (
          <PriceChart
            data={chartData}
            predictedPrice={detail.predictedPrice ?? undefined}
            currency={currency}
          />
        ) : (
          <p className="text-sm text-faint py-8 text-center">
            Historique insuffisant pour tracer une courbe — revenez après quelques scrapes.
          </p>
        )}
      </section>

      {/* History table */}
      {detail.history.length > 0 && (
        <section className="bg-surface rounded-2xl border border-border p-5">
          <h2 className="font-semibold text-foreground mb-3">
            Historique{' '}
            <span className="text-xs font-normal text-faint">
              ({detail.history.length} entrée{detail.history.length > 1 ? 's' : ''}
              {detail.history.length > 15 ? ', 15 dernières affichées' : ''})
            </span>
          </h2>
          <HistoryTable detail={detail} currency={currency} />
        </section>
      )}
    </main>
  );
}

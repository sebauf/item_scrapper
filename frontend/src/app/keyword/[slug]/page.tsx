import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/mongodb';
import type { Product } from '@/types/product';

export const dynamic = 'force-dynamic';

async function getProducts(keyword: string): Promise<Product[]> {
  const db = await getDb();
  const results = await db
    .collection('items_raw')
    .aggregate([
      { $match: { keyword } },
      { $sort: { day: -1 } },
      { $group: { _id: '$url', doc: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$doc' } },
      { $sort: { 'price.amount': 1 } },
    ])
    .toArray();

  return results.map((r) => ({
    ...r,
    _id: r._id.toString(),
    scrapedAt: r.scrapedAt instanceof Date ? r.scrapedAt.toISOString() : String(r.scrapedAt),
  })) as Product[];
}

function formatPrice(amount: number, currency: string) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(amount);
}

function discountPct(price: number, crossed: number) {
  return Math.round((1 - price / crossed) * 100);
}

export default async function KeywordPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const keyword = decodeURIComponent(slug);
  const products = await getProducts(keyword);

  if (products.length === 0) notFound();

  return (
    <main className="max-w-6xl mx-auto px-4 py-10">
      <Link href="/" className="text-sm text-gray-500 hover:text-gray-700 mb-6 inline-block">
        ← Retour
      </Link>
      <h1 className="text-2xl font-bold mb-1 capitalize">{keyword}</h1>
      <p className="text-gray-500 mb-8">
        {products.length} produit{products.length !== 1 ? 's' : ''}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {products.map((p) => (
          <a
            key={p.url}
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col rounded-xl border border-gray-200 hover:border-gray-400 hover:shadow-md transition-all overflow-hidden"
          >
            {p.images[0] && (
              <div className="relative h-48 bg-gray-50">
                <Image
                  src={p.images[0]}
                  alt={p.title}
                  fill
                  className="object-contain p-2"
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                />
              </div>
            )}
            <div className="p-4 flex flex-col gap-2 flex-1">
              <p className="text-sm font-medium line-clamp-3 text-gray-800">{p.title}</p>

              <div className="mt-auto">
                <div className="flex items-baseline gap-2 flex-wrap">
                  {p.price && (
                    <span className="text-lg font-bold text-gray-900">
                      {formatPrice(p.price.amount, p.price.currency)}
                    </span>
                  )}
                  {p.crossedOutPrice && (
                    <>
                      <span className="text-sm text-gray-400 line-through">
                        {formatPrice(p.crossedOutPrice.amount, p.crossedOutPrice.currency)}
                      </span>
                      {p.price && (
                        <span className="text-xs font-semibold text-green-700 bg-green-50 px-1.5 py-0.5 rounded">
                          -{discountPct(p.price.amount, p.crossedOutPrice.amount)}%
                        </span>
                      )}
                    </>
                  )}
                </div>
                {p.unitPrice && p.price && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    {formatPrice(p.unitPrice.amount, p.price.currency)}/{p.unitPrice.unit}
                  </p>
                )}
                {p.deliveryDate && (
                  <p className="text-xs text-gray-400 mt-0.5">Livraison : {p.deliveryDate}</p>
                )}
              </div>
            </div>
          </a>
        ))}
      </div>
    </main>
  );
}

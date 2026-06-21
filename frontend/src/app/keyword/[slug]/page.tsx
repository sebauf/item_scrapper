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
      { $match: { title: { $ne: '' } } },
      { $sort: { 'price.amount': 1 } },
    ])
    .toArray();

  const products = results.map((r) => ({
    ...r,
    _id: r._id.toString(),
    scrapedAt: r.scrapedAt instanceof Date ? r.scrapedAt.toISOString() : String(r.scrapedAt),
  })) as Product[];

  const scores = await db
    .collection<{ _id: string; score: number }>('deal_scores')
    .find({ _id: { $in: products.map((p) => p.url) } })
    .toArray();
  const scoreByUrl = new Map(scores.map((s) => [s._id, s.score]));

  return products.map((p) => ({ ...p, dealScore: scoreByUrl.get(p.url) }));
}

function formatPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(amount);
  } catch {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
  }
}

function discountPercentage(price: number, crossedOutPrice: number): number {
  return Math.round((1 - price / crossedOutPrice) * 100);
}

function ProductImage({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="relative h-48 bg-gray-50">
      <Image
        src={src}
        alt={alt}
        fill
        className="object-contain p-2"
        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
      />
    </div>
  );
}

function PriceBlock({ product }: { product: Product }) {
  const { price, crossedOutPrice, unitPrice, deliveryDate } = product;

  return (
    <div className="mt-auto">
      <div className="flex items-baseline gap-2 flex-wrap">
        {price && (
          <span className="text-lg font-bold text-gray-900">
            {formatPrice(price.amount, price.currency)}
          </span>
        )}
        {crossedOutPrice && (
          <>
            <span className="text-sm text-gray-400 line-through">
              {formatPrice(crossedOutPrice.amount, crossedOutPrice.currency)}
            </span>
            {price && (
              <span className="text-xs font-semibold text-green-700 bg-green-50 px-1.5 py-0.5 rounded">
                -{discountPercentage(price.amount, crossedOutPrice.amount)}%
              </span>
            )}
          </>
        )}
      </div>
      {unitPrice && price && (
        <p className="text-xs text-gray-400 mt-0.5">
          {formatPrice(unitPrice.amount, price.currency)}/{unitPrice.unit}
        </p>
      )}
      {deliveryDate && <p className="text-xs text-gray-400 mt-0.5">Livraison : {deliveryDate}</p>}
      {product.dealScore !== undefined && product.dealScore >= 10 && (
        <p className="text-xs font-semibold text-blue-700 bg-blue-50 inline-block px-1.5 py-0.5 rounded mt-1">
          Bonne affaire (-{Math.round(product.dealScore)}% vs prix attendu)
        </p>
      )}
    </div>
  );
}

function ProductCard({ product }: { product: Product }) {
  return (
    <a
      href={product.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex flex-col rounded-xl border border-gray-200 hover:border-gray-400 hover:shadow-md transition-all overflow-hidden"
    >
      {product.images[0] && <ProductImage src={product.images[0]} alt={product.title} />}
      <div className="p-4 flex flex-col gap-2 flex-1">
        <p className="text-sm font-medium line-clamp-3 text-gray-800">{product.title}</p>
        <PriceBlock product={product} />
      </div>
    </a>
  );
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
          <ProductCard key={p.url} product={p} />
        ))}
      </div>
    </main>
  );
}

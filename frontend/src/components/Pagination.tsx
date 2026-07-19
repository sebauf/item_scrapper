import Link from 'next/link';
import { buildQueryString, type ProductListParams } from '@/lib/search-params';

function pageWindow(current: number, count: number): (number | 'gap')[] {
  const wanted = new Set([1, count, current - 1, current, current + 1]);
  const pages = [...wanted].filter((p) => p >= 1 && p <= count).sort((a, b) => a - b);

  const out: (number | 'gap')[] = [];
  let prev = 0;
  for (const p of pages) {
    if (p - prev > 1) out.push('gap');
    out.push(p);
    prev = p;
  }
  return out;
}

export function Pagination({
  basePath,
  params,
  pageCount,
}: {
  basePath: string;
  params: ProductListParams;
  pageCount: number;
}) {
  if (pageCount <= 1) return null;

  const { page } = params;
  const href = (n: number) => basePath + buildQueryString({ ...params, page: n });

  const navBtn =
    'flex items-center px-3 py-2 rounded-xl border text-sm font-medium transition-colors';
  const enabled = `${navBtn} border-border bg-surface text-muted hover:text-foreground hover:border-ghost`;
  const disabled = `${navBtn} border-border-subtle text-ghost cursor-default`;

  return (
    <nav aria-label="Pagination" className="flex items-center justify-center gap-1.5 py-8 flex-wrap">
      {page > 1 ? (
        <Link href={href(page - 1)} className={enabled} rel="prev">
          ← <span className="hidden sm:inline ml-1">Précédent</span>
        </Link>
      ) : (
        <span className={disabled}>
          ← <span className="hidden sm:inline ml-1">Précédent</span>
        </span>
      )}

      {pageWindow(page, pageCount).map((item, i) =>
        item === 'gap' ? (
          <span key={`gap-${i}`} className="px-1.5 text-faint select-none">
            …
          </span>
        ) : (
          <Link
            key={item}
            href={href(item)}
            aria-current={item === page ? 'page' : undefined}
            className={`min-w-10 text-center px-3 py-2 rounded-xl text-sm font-semibold transition-colors ${
              item === page
                ? 'bg-accent text-on-accent'
                : 'border border-border bg-surface text-muted hover:text-foreground hover:border-ghost'
            }`}
          >
            {item}
          </Link>
        ),
      )}

      {page < pageCount ? (
        <Link href={href(page + 1)} className={enabled} rel="next">
          <span className="hidden sm:inline mr-1">Suivant</span> →
        </Link>
      ) : (
        <span className={disabled}>
          <span className="hidden sm:inline mr-1">Suivant</span> →
        </span>
      )}
    </nav>
  );
}

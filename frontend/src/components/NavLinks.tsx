'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  {
    href: '/',
    label: 'Dashboard',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 13a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1h-4a1 1 0 01-1-1v-6z" />
      </svg>
    ),
  },
  {
    href: '/keywords',
    label: 'Mots-clés',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
      </svg>
    ),
  },
];

function isActive(linkHref: string, pathname: string): boolean {
  if (linkHref === '/') return pathname === '/';
  // /keywords matches /keywords, /keyword/[slug] and /product/[id] (reached from results)
  if (linkHref === '/keywords') {
    return pathname === '/keywords' || pathname.startsWith('/keyword/') || pathname.startsWith('/product/');
  }
  return pathname.startsWith(linkHref);
}

export function NavLinks() {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop: inline nav in header */}
      <nav className="hidden md:flex items-center gap-1 ml-6 border-l border-border-subtle pl-6">
        {links.map((link) => {
          const active = isActive(link.href, pathname);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? 'page' : undefined}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-accent-soft text-accent'
                  : 'text-muted hover:text-foreground hover:bg-surface-hover'
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>

      {/* Mobile: fixed bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 bg-surface/95 backdrop-blur-sm border-t border-border z-30 md:hidden pb-[env(safe-area-inset-bottom)]">
        <div className="flex">
          {links.map((link) => {
            const active = isActive(link.href, pathname);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={`relative flex-1 flex flex-col items-center gap-1 py-2.5 transition-colors ${
                  active ? 'text-accent' : 'text-faint hover:text-muted'
                }`}
              >
                {active && (
                  <span className="absolute top-0 inset-x-6 h-0.5 rounded-full bg-accent" />
                )}
                <span>{link.icon}</span>
                <span className="text-[11px] font-medium">{link.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}

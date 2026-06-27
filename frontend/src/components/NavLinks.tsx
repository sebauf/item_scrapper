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
  // /keywords matches /keywords and /keyword/[slug]
  if (linkHref === '/keywords') return pathname === '/keywords' || pathname.startsWith('/keyword/');
  return pathname.startsWith(linkHref);
}

export function NavLinks() {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop: inline nav in header */}
      <nav className="hidden md:flex items-center gap-1 ml-6 border-l border-gray-100 pl-6">
        {links.map((link) => {
          const active = isActive(link.href, pathname);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>

      {/* Mobile: fixed bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t border-gray-200 z-30 md:hidden">
        <div className="flex">
          {links.map((link) => {
            const active = isActive(link.href, pathname);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex-1 flex flex-col items-center gap-1 py-2.5 pb-safe transition-colors ${
                  active ? 'text-indigo-600' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                <span className={active ? 'text-indigo-600' : 'text-gray-400'}>{link.icon}</span>
                <span className="text-[11px] font-medium">{link.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}

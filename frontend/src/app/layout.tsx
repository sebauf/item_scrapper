import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { NavLinks } from '@/components/NavLinks';
import './globals.css';

export const metadata: Metadata = {
  title: 'Price Tracker',
  description: 'Suivez les prix Amazon en temps réel',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#131a26' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <header className="bg-surface border-b border-border-subtle sticky top-0 z-20 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 h-14 flex items-center">
            <Link
              href="/"
              className="flex items-center gap-2 font-bold text-foreground hover:text-accent transition-colors shrink-0"
            >
              <span className="text-xl leading-none">📈</span>
              <span className="text-base tracking-tight">Price Tracker</span>
            </Link>
            <NavLinks />
          </div>
        </header>

        {/* pb-16 on mobile leaves room for the fixed bottom tab bar */}
        <div className="pb-16 md:pb-0">
          {children}
        </div>
      </body>
    </html>
  );
}

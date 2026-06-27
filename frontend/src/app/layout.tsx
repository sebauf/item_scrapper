import type { Metadata } from 'next';
import Link from 'next/link';
import { NavLinks } from '@/components/NavLinks';
import './globals.css';

export const metadata: Metadata = {
  title: 'Price Tracker',
  description: 'Suivez les prix Amazon en temps réel',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        <header className="bg-white border-b border-gray-100 sticky top-0 z-20 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 h-14 flex items-center">
            <Link
              href="/"
              className="flex items-center gap-2 font-bold text-gray-900 hover:text-indigo-600 transition-colors shrink-0"
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

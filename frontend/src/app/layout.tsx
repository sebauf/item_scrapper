import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { auth } from '@/auth';
import { NavLinks } from '@/components/NavLinks';
import { UserMenu } from '@/components/UserMenu';
import './globals.css';

export const metadata: Metadata = {
  title: 'Price Tracker',
  description: 'Suivez les prix Amazon en temps réel',
  // iOS ignore les icônes du manifeste : il lui faut son apple-touch-icon
  // (opaque — il remplit la transparence en noir et arrondit lui-même).
  icons: {
    icon: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  // Ouverte depuis l'écran d'accueil d'un iPhone : plein écran, sous ce nom.
  appleWebApp: { capable: true, title: 'Price Tracker', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#131a26' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Sans session (page de connexion), l'en-tête se réduit au logo : la
  // navigation ne mènerait qu'à des redirections vers /login.
  const session = await auth();
  const email = session?.user?.email ?? null;

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
            {email && (
              <>
                <NavLinks />
                <UserMenu name={session?.user?.name ?? null} email={email} />
              </>
            )}
          </div>
        </header>

        {/* pb-16 on mobile leaves room for the fixed bottom tab bar */}
        <div className={email ? 'pb-16 md:pb-0' : undefined}>
          {children}
        </div>
      </body>
    </html>
  );
}

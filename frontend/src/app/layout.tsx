import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Price Tracker',
  description: 'Track Amazon product prices',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="bg-white text-gray-900 antialiased">{children}</body>
    </html>
  );
}

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // Pas de serverActions.allowedOrigins : le contrôle CSRF de Next.js ne se
  // déclenche que si origin != x-forwarded-host, et l'ingress frontend étant
  // catch-all (sans host, cf. k8s/base/ingress.yaml), les deux sont toujours
  // identiques quel que soit le nom utilisé pour joindre le serveur. Ne pas
  // remettre de proxy qui réécrit le Host devant le frontend.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.media-amazon.com' },
    ],
  },
};

export default nextConfig;

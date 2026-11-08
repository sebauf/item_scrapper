import type { MetadataRoute } from 'next';

/**
 * Manifeste de la PWA, servi par Next.js sur `/manifest.webmanifest` (le lien
 * `<link rel="manifest">` est ajouté d'office dans `<head>`).
 *
 * C'est lui qui rend le site installable sur l'écran d'accueil — Chrome sur
 * Android propose « Installer l'application », Safari sur iOS passe par
 * Partager → « Sur l'écran d'accueil » — et l'ouvre ensuite sans barre
 * d'adresse (`standalone`). Aucun store, aucun compte développeur : l'app
 * installée reste ce site, avec la même session et les mêmes règles.
 *
 * Le navigateur télécharge ce fichier et les icônes **sans cookie de
 * session** : ils sont donc exclus de la garde d'authentification
 * (`middleware.ts`), sinon ils seraient redirigés vers `/login` et
 * l'installation échouerait sans message.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Price Tracker',
    short_name: 'Price Tracker',
    description: 'Suivez les prix Amazon et des carburants',
    lang: 'fr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    // Écran de démarrage : `--color-background` (thème clair) de globals.css.
    // Le manifeste ne connaît qu'une couleur ; une fois la page chargée, les
    // <meta name="theme-color"> du layout (clair / sombre) prennent le relais.
    background_color: '#f9fafb',
    theme_color: '#ffffff',
    icons: [
      // « any » et « maskable » séparés : une icône déclarée « any maskable »
      // serait soit rognée (emoji pleine taille), soit minuscule.
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

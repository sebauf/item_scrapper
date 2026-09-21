import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

/**
 * Vitest plutôt que Jest : le frontend est déjà servi par un bundler, et
 * Vitest lit `tsconfig.json` (donc l'alias `@/`) sans transformation à
 * configurer.
 *
 * Aucun test n'ouvre de connexion réseau : `fetch` est toujours bouchonné, et
 * `BACKEND_URL` est figé ici pour que les assertions d'URL ne dépendent pas de
 * l'environnement de la machine qui exécute les tests.
 */
export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    env: { BACKEND_URL: 'http://backend.test' },
    restoreMocks: true,
  },
});

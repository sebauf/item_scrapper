import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// Le middleware et le layout réexportent / appellent Auth.js : inutile ici, on
// ne lit que leurs constantes (`config`, `metadata`).
vi.mock('@/auth', () => ({ auth: vi.fn() }));

const { default: manifest } = await import('./manifest');
const { metadata } = await import('./layout');
const { config } = await import('../middleware');

const PUBLIC_DIR = join(__dirname, '..', '..', 'public');

/**
 * Le `matcher` tel que Next.js l'applique au chemin (ancré aux deux bouts).
 * Vrai = le middleware s'exécute, donc une requête sans session est
 * redirigée vers /login.
 */
function guarded(path: string): boolean {
  return config.matcher.some((pattern) => new RegExp(`^${pattern}$`).test(path));
}

/** Largeur × hauteur lues dans l'en-tête IHDR d'un PNG. */
function pngSize(path: string): string {
  const bytes = readFileSync(path);
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

type Icon = { url: string; sizes: string };
const manifestIcons: Icon[] = (manifest().icons ?? []).map((i) => ({ url: i.src, sizes: i.sizes ?? '' }));
const layoutIcons = metadata.icons as { icon: Icon[]; apple: Icon[] };
const ALL_ICONS = [...manifestIcons, ...layoutIcons.icon, ...layoutIcons.apple];

describe('PWA : manifeste et icônes', () => {
  it('déclare une app autonome, avec des icônes « any » et « maskable » en 192 et 512', () => {
    const m = manifest();
    expect(m.display).toBe('standalone');
    expect(m.start_url).toBe('/');
    for (const purpose of ['any', 'maskable']) {
      const sizes = m.icons?.filter((i) => i.purpose === purpose).map((i) => i.sizes);
      expect(sizes).toEqual(['192x192', '512x512']);
    }
  });

  it.each(ALL_ICONS)('$url existe dans public/ et mesure bien $sizes', ({ url, sizes }) => {
    expect(pngSize(join(PUBLIC_DIR, url))).toBe(sizes);
  });
});

describe('PWA : le manifeste et les icônes se téléchargent sans session', () => {
  it.each(['/manifest.webmanifest', ...ALL_ICONS.map((i) => i.url)])('%s échappe à la garde', (path) => {
    expect(guarded(path)).toBe(false);
  });

  // Témoin : sans lui, un matcher cassé (qui ne garderait plus rien) ferait
  // passer le test ci-dessus.
  it.each(['/', '/fuel', '/fuel/favorites', '/profile', '/keywords', '/product/abc', '/manifest', '/icons'])(
    'témoin : la page %s reste gardée',
    (path) => {
      expect(guarded(path)).toBe(true);
    },
  );
});

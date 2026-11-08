/**
 * Génère les icônes de la PWA à partir de l'emoji 📈 du logo.
 *
 * Ne fait pas partie du build : les PNG produits sont versionnés dans
 * `public/icons/`. À relancer seulement pour changer d'icône :
 *
 *   NODE_PATH=$(npm root -g) node scripts/generate-icons.mjs
 *
 * Prérequis (hors dépendances du frontend, volontairement) : Playwright avec
 * Chromium, et la police Noto Color Emoji (SIL OFL 1.1) installée sur la
 * machine — c'est elle qui dessine l'emoji, le rendu ne dépend donc pas du
 * système qui affichera l'icône.
 *
 * Trois variantes, parce que chaque plateforme traite l'icône différemment :
 * - `icon-*.png` (purpose « any ») : fond transparent, l'emoji occupe l'icône ;
 * - `maskable-*.png` : fond plein jusqu'aux bords, emoji dans la zone sûre
 *   (cercle central de 80 % du côté) — Android découpe l'icône en cercle,
 *   carré arrondi… selon le lanceur, et rognerait un emoji pleine taille ;
 * - `apple-touch-icon.png` : fond plein, iOS remplit la transparence en noir
 *   et arrondit lui-même les coins.
 */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// `require` plutôt qu'`import` : il suit NODE_PATH, donc trouve aussi un
// Playwright installé globalement (`NODE_PATH=$(npm root -g) node …`).
const { chromium } = createRequire(import.meta.url)('playwright');

const EMOJI = '📈';
/** `--color-accent` de globals.css. */
const BACKGROUND = '#4f46e5';
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const VARIANTS = [
  { file: 'icon-192.png', size: 192, scale: 0.92, background: null },
  { file: 'icon-512.png', size: 512, scale: 0.92, background: null },
  { file: 'maskable-192.png', size: 192, scale: 0.55, background: BACKGROUND },
  { file: 'maskable-512.png', size: 512, scale: 0.55, background: BACKGROUND },
  { file: 'apple-touch-icon.png', size: 180, scale: 0.68, background: BACKGROUND },
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');
  for (const variant of VARIANTS) {
    const dataUrl = await page.evaluate(
      async ({ emoji, size, scale, background }) => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (background) {
          ctx.fillStyle = background;
          ctx.fillRect(0, 0, size, size);
        }
        const font = `${size}px "Noto Color Emoji"`;
        await document.fonts.load(font, emoji);
        ctx.font = font;
        // Le glyphe n'occupe pas tout son em : on mesure sa boîte réelle pour
        // le mettre à l'échelle voulue et le centrer exactement.
        const m = ctx.measureText(emoji);
        const width = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
        const height = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
        const fontSize = (size * scale * size) / Math.max(width, height);
        ctx.font = `${fontSize}px "Noto Color Emoji"`;
        const s = ctx.measureText(emoji);
        const x = (size - (s.actualBoundingBoxLeft + s.actualBoundingBoxRight)) / 2 + s.actualBoundingBoxLeft;
        const y = (size - (s.actualBoundingBoxAscent + s.actualBoundingBoxDescent)) / 2 + s.actualBoundingBoxAscent;
        ctx.fillText(emoji, x, y);
        return canvas.toDataURL('image/png');
      },
      { emoji: EMOJI, ...variant },
    );
    writeFileSync(join(OUT_DIR, variant.file), Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log(`${variant.file} (${variant.size}×${variant.size})`);
  }
} finally {
  await browser.close();
}

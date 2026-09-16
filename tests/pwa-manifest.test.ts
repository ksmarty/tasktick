/**
 * Installability contract for `public/manifest.webmanifest`.
 *
 * A manifest that drifts from the icon files is the classic silent PWA
 * regression: Chrome refuses to fire `beforeinstallprompt` and nothing in the
 * app behaviour tells you why. So this test decodes the icons the manifest
 * points at and compares their real pixel size with the declared `sizes`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodePng } from '../scripts/generate-icons';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

interface Manifest {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  display_override: string[];
  orientation: string;
  theme_color: string;
  background_color: string;
  categories: string[];
  icons: ManifestIcon[];
}

const manifest: Manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/manifest.webmanifest'), 'utf8'));

describe('manifest.webmanifest', () => {
  it('declares the installability essentials', () => {
    expect(manifest.id).toBe('/');
    expect(manifest.name.length).toBeGreaterThan(0);
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.display_override).toContain('standalone');
    expect(manifest.orientation).toBe('any');
  });

  it('declares theme and background colours as hex', () => {
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.categories.length).toBeGreaterThan(0);
  });

  it('offers both any and maskable icons at 192 and 512', () => {
    const find = (purpose: string, sizes: string) =>
      manifest.icons.find((icon) => icon.purpose === purpose && icon.sizes === sizes);

    for (const purpose of ['any', 'maskable']) {
      for (const sizes of ['192x192', '512x512']) {
        const icon = find(purpose, sizes);
        expect(icon, `${purpose} ${sizes} icon`).toBeDefined();
        expect(icon!.type).toBe('image/png');
      }
    }
  });

  it('points every icon at a file whose real pixels match the declared size', () => {
    for (const icon of manifest.icons) {
      const file = path.join(ROOT, 'public', icon.src.replace(/^\//, ''));
      expect(fs.existsSync(file), `${icon.src} is missing`).toBe(true);

      if (icon.type === 'image/png') {
        const png = decodePng(fs.readFileSync(file));
        expect(`${png.width}x${png.height}`, icon.src).toBe(icon.sizes);
      } else {
        const svg = fs.readFileSync(file, 'utf8');
        expect(svg.startsWith('<svg'), icon.src).toBe(true);
      }
    }
  });

  it('keeps the icon paths under /icons, which the service worker treats as immutable', () => {
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith('/icons/'), icon.src).toBe(true);
    }
  });
});

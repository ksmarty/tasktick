/**
 * The rasterisation half of `scripts/generate-icons.ts`, and the files it has
 * already written.
 *
 * The geometry helpers are pure, so the shapes can be asserted numerically
 * instead of by eyeballing PNGs; the file checks then treat the committed
 * assets as the source of truth (decode them and measure), which is the only
 * way to catch "the generator ran but produced a 1x1 file".
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MARK_DESIGN_WIDTH,
  coverageFromDistance,
  decodePng,
  distanceToSegment,
  markBounds,
  markCoverageAt,
  markRadius,
  markScaleForWidthRatio,
  markTransform,
  maskableSafeRadius,
  renderIcon,
  roundedRectDistance,
  type DecodedPng,
} from '../scripts/generate-icons';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadPng(relativePath: string): DecodedPng {
  return decodePng(fs.readFileSync(path.join(ROOT, relativePath)));
}

function pixelAt(png: DecodedPng, x: number, y: number): [number, number, number, number] {
  const offset = (y * png.width + x) * 4;
  return [png.pixels[offset], png.pixels[offset + 1], png.pixels[offset + 2], png.pixels[offset + 3]];
}

/** Alpha of one pixel inside a bare RGBA buffer of `size` x `size`. */
function alphaAt(pixels: Uint8Array, size: number, x: number, y: number): number {
  return pixels[(y * size + x) * 4 + 3];
}

/** Bounding box of the white checkmark ink; the tile gradient is never this bright. */
function inkBox(png: DecodedPng): { minX: number; minY: number; maxX: number; maxY: number; count: number } {
  let minX = png.width;
  let minY = png.height;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const offset = (y * png.width + x) * 4;
      if (png.pixels[offset] > 200 && png.pixels[offset + 1] > 200) {
        count += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, minY, maxX, maxY, count };
}

describe('geometry helpers', () => {
  it('measures distance to a segment, clamped at both ends', () => {
    expect(distanceToSegment(0.5, 0, 0, 0, 1, 0)).toBeCloseTo(0, 10);
    expect(distanceToSegment(0, 1, 0, 0, 1, 0)).toBeCloseTo(1, 10);
    expect(distanceToSegment(-1, 0, 0, 0, 1, 0)).toBeCloseTo(1, 10); // clamped to A
    expect(distanceToSegment(2, 0, 0, 0, 1, 0)).toBeCloseTo(1, 10); // clamped to B
    expect(distanceToSegment(3, 4, 3, 4, 3, 4)).toBeCloseTo(0, 10); // degenerate
  });

  it('turns a signed distance into anti-aliased coverage over one pixel', () => {
    expect(coverageFromDistance(0, 1)).toBeCloseTo(0.5, 10);
    expect(coverageFromDistance(-1, 1)).toBe(1);
    expect(coverageFromDistance(-0.5, 1)).toBe(1);
    expect(coverageFromDistance(1, 1)).toBe(0);
    expect(coverageFromDistance(0.25, 1)).toBeCloseTo(0.25, 10);
  });

  it('computes the rounded-rectangle signed distance', () => {
    expect(roundedRectDistance(0, 0, 10, 10, 0)).toBeCloseTo(-5, 10);
    expect(roundedRectDistance(5, 0, 10, 10, 0)).toBeCloseTo(0, 10);
    expect(roundedRectDistance(7, 0, 10, 10, 0)).toBeCloseTo(2, 10);
    // Rounding cuts the corner away: the square's corner sits on the boundary
    // (0), the rounded one sits outside it (positive).
    expect(roundedRectDistance(5, 5, 10, 10, 0)).toBeCloseTo(0, 10);
    expect(roundedRectDistance(5, 5, 10, 10, 3)).toBeGreaterThan(0);
    expect(roundedRectDistance(4, 4, 10, 10, 3)).toBeLessThan(0);
  });

  it('maps the mark so its drawn bounds are centred on the requested point', () => {
    const mark = markTransform(100, 40, 64);
    const bounds = markBounds(mark);
    expect((bounds.minX + bounds.maxX) / 2).toBeCloseTo(100, 6);
    expect((bounds.minY + bounds.maxY) / 2).toBeCloseTo(40, 6);
    expect(mark.strokeHalfWidth).toBeGreaterThan(0);
  });

  it('scales the mark so its drawn width matches the requested ratio', () => {
    const size = 512;
    const ratio = 0.55;
    const mark = markTransform(size / 2, size / 2, markScaleForWidthRatio(size, ratio));
    const bounds = markBounds(mark);
    expect((bounds.maxX - bounds.minX) / size).toBeCloseTo(ratio, 3);
    // MARK_DESIGN_WIDTH is the same measurement at scale 1.
    expect(MARK_DESIGN_WIDTH).toBeCloseTo(0.551, 3);
  });

  it('keeps the maskable mark inside the 80% safe circle', () => {
    for (const size of [192, 512]) {
      const mark = markTransform(size / 2, size / 2, markScaleForWidthRatio(size, 0.46));
      expect(markRadius(mark)).toBeLessThan(maskableSafeRadius(size));
      expect(maskableSafeRadius(size)).toBeCloseTo(0.4 * size, 10);
    }
  });

  it('puts full ink on the stroke and a half-covered edge exactly one stroke-width out', () => {
    const mark = markTransform(256, 256, 400);
    const [a, b] = mark.points;
    const midX = (a[0] + b[0]) / 2;
    const midY = (a[1] + b[1]) / 2;
    expect(markCoverageAt(midX, midY, mark)).toBe(1);

    // Step off the segment along its normal by exactly the stroke's half width.
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    const normalX = -dy / length;
    const normalY = dx / length;
    const edgeX = midX + normalX * mark.strokeHalfWidth;
    const edgeY = midY + normalY * mark.strokeHalfWidth;
    expect(markCoverageAt(edgeX, edgeY, mark)).toBeCloseTo(0.5, 6);

    expect(markCoverageAt(256, 30, mark)).toBe(0);
    expect(markCoverageAt(20, 480, mark)).toBe(0);
  });
});

describe('renderIcon', () => {
  it('leaves the tile corners transparent for a standard icon', () => {
    const pixels = renderIcon({ size: 64, fullBleed: false, markWidthRatio: 0.55 });
    expect(alphaAt(pixels, 64, 0, 0)).toBe(0); // rounded corner
    expect(alphaAt(pixels, 64, 40, 10)).toBe(255); // inside the tile
  });

  it('paints every maskable pixel opaque', () => {
    const pixels = renderIcon({ size: 64, fullBleed: true, markWidthRatio: 0.46 });
    for (let i = 3; i < pixels.length; i += 4) expect(pixels[i]).toBe(255);
  });

  it('paints an apple-touch icon as an opaque, un-rounded square', () => {
    const pixels = renderIcon({ size: 180, fullBleed: true, markWidthRatio: 0.55 });
    const corners = [0, 179 * 4, 179 * 180 * 4, (180 * 180 - 1) * 4];
    for (const offset of corners) {
      expect(pixels[offset + 3]).toBe(255); // opaque: iOS would show black corners otherwise
      expect(pixels[offset]).toBeGreaterThan(0); // filled, not background showing through
    }
  });
});

describe('generated icon files', () => {
  const expected: Array<[string, number]> = [
    ['public/icons/icon-192.png', 192],
    ['public/icons/icon-512.png', 512],
    ['public/icons/icon-maskable-192.png', 192],
    ['public/icons/icon-maskable-512.png', 512],
    ['public/icons/apple-touch-icon.png', 180],
    ['public/icons/favicon.png', 32],
  ];

  for (const [file, size] of expected) {
    it(`${file} is a non-empty ${size}x${size} PNG`, () => {
      const bytes = fs.statSync(path.join(ROOT, file)).size;
      expect(bytes).toBeGreaterThan(100);
      const png = loadPng(file);
      expect(png.width).toBe(size);
      expect(png.height).toBe(size);
    });
  }

  it('ships the scalable source', () => {
    const svg = fs.readFileSync(path.join(ROOT, 'public/icons/icon.svg'), 'utf8');
    expect(svg).toContain('<svg');
    expect(svg).toContain('linearGradient');
    expect(svg).toContain('stroke-linecap="round"');
  });

  it('keeps the maskable artwork opaque and inside the safe circle', () => {
    const png = loadPng('public/icons/icon-maskable-512.png');
    for (let i = 3; i < png.pixels.length; i += 4) expect(png.pixels[i]).toBe(255);

    const ink = inkBox(png);
    expect(ink.count).toBeGreaterThan(1000);
    const centre = png.width / 2;
    const furthest = Math.max(
      Math.hypot(ink.minX - centre, ink.minY - centre),
      Math.hypot(ink.maxX - centre, ink.minY - centre),
      Math.hypot(ink.minX - centre, ink.maxY - centre),
      Math.hypot(ink.maxX - centre, ink.maxY - centre),
    );
    expect(furthest).toBeLessThan(maskableSafeRadius(png.width));
  });

  it('draws the standard icon as a rounded tile with a centred mark', () => {
    const png = loadPng('public/icons/icon-512.png');
    expect(pixelAt(png, 0, 0)[3]).toBe(0); // rounded corner
    expect(pixelAt(png, 256, 20)[3]).toBe(255);
    const ink = inkBox(png);
    expect(Math.abs((ink.minX + ink.maxX) / 2 - 256)).toBeLessThan(4);
    expect((ink.maxX - ink.minX) / png.width).toBeGreaterThan(0.4);
  });

  it('never emits transparency in the apple-touch icon', () => {
    const png = loadPng('public/icons/apple-touch-icon.png');
    for (let i = 3; i < png.pixels.length; i += 4) expect(png.pixels[i]).toBe(255);
  });
});

describe('generated splash screens', () => {
  const sizes: Array<[number, number]> = [
    [1290, 2796],
    [1179, 2556],
    [1170, 2532],
    [1284, 2778],
    [1125, 2436],
    [2048, 2732],
  ];

  for (const [width, height] of sizes) {
    it(`public/splash/splash-${width}x${height}.png is a ${width}x${height} portrait PNG`, () => {
      const png = loadPng(`public/splash/splash-${width}x${height}.png`);
      expect(png.width).toBe(width);
      expect(png.height).toBe(height);

      const [r, g, b, a] = pixelAt(png, 2, 2);
      expect([r, g, b, a]).toEqual([0x0a, 0x84, 0xff, 255]); // tile colour, opaque

      const ink = inkBox(png);
      expect(ink.count).toBeGreaterThan(1000);
      // Mark centred, at roughly a quarter of the screen width.
      expect(Math.abs((ink.minX + ink.maxX) / 2 - width / 2)).toBeLessThan(8);
      expect((ink.maxX - ink.minX) / width).toBeGreaterThan(0.2);
      expect((ink.maxX - ink.minX) / width).toBeLessThan(0.3);
      expect(Math.abs((ink.minY + ink.maxY) / 2 - height / 2)).toBeLessThan(8);
    });
  }
});

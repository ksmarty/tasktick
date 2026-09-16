/**
 * TaskTick PWA icon + splash generator.
 *
 *   npx tsx scripts/generate-icons.ts        (also: npm run icons)
 *
 * Why this exists: neither the dev box nor the runtime image ships image
 * tooling — no sharp, no canvas, no jimp, no pngjs, and we refuse to add one —
 * so the artwork is rasterised procedurally and wrapped in a ~100 line PNG
 * writer built on `node:zlib` (deflate) plus a table-driven CRC32.
 *
 * The rasteriser is signed-distance-field based, so every edge (the tile's
 * rounded corners, the round caps of the checkmark) gets one pixel of analytic
 * anti-aliasing instead of a stair-stepped hard edge.
 *
 * Everything is deterministic: identical geometry in -> byte-identical PNG out,
 * so regenerating never churns the committed files.
 *
 * Output:
 *   public/icons/icon-192.png           192  rounded tile, transparent corners
 *   public/icons/icon-512.png           512  ditto
 *   public/icons/icon-maskable-192.png  192  full-bleed, mark inside 80% safe circle
 *   public/icons/icon-maskable-512.png  512  ditto
 *   public/icons/apple-touch-icon.png   180  fully opaque, square corners
 *                                            (iOS applies its own mask; a pre-rounded
 *                                             or transparent icon shows black corners)
 *   public/icons/favicon.png             32  rounded tile
 *   public/icons/icon.svg               any  scalable source, same geometry
 *   public/splash/splash-<w>x<h>.png         iOS startup images, portrait
 *
 * The PNG writer, the decoder used to verify the files on the way out, and the
 * geometry helpers are all exported: `tests/pwa-icons.test.ts` and
 * `tests/pwa-png.test.ts` exercise them directly.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

/* ========================================================================== */
/* constants                                                                  */
/* ========================================================================== */

/** iOS systemBlue / systemIndigo — the tile gradient, light appearance. */
export const TILE_GRADIENT_FROM = '#0a84ff';
export const TILE_GRADIENT_TO = '#5e5ce6';

/** The splash background is the tile colour, per the iOS startup-image spec. */
const SPLASH_BACKGROUND = '#0a84ff';

/** Corner radius as a fraction of the tile size (Apple's squircle ≈ 22.4%). */
export const TILE_CORNER_RADIUS_RATIO = 0.2237;

/** Mark ink colour: pure white, like the rest of the system glyph vocabulary. */
const MARK_COLOR = { r: 255, g: 255, b: 255 };

/* ========================================================================== */
/* PNG encoder                                                                */
/* ========================================================================== */

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let bit = 0; bit < 8; bit += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3), as required by every PNG chunk. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** One PNG chunk: length + type + data + CRC over (type + data). */
function chunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'latin1');
  const body = Buffer.concat([typeBytes, data]);
  const out = Buffer.allocUnsafe(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/**
 * Encode straight (non-premultiplied) 8-bit RGBA pixels as a PNG.
 *
 * Minimal but complete: signature, IHDR, IDAT, IEND. Colour type 6 (truecolour
 * with alpha), bit depth 8, no interlace, filter type 0 (None) on every
 * scanline — filtering would buy a few percent for our flat artwork and cost a
 * page of code we would then have to trust.
 */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`encodePng: bad dimensions ${width}x${height}`);
  }
  if (rgba.length !== width * height * 4) {
    throw new Error(`encodePng: expected ${width * height * 4} RGBA bytes, got ${rgba.length}`);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour + alpha
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method: adaptive
  ihdr[12] = 0; // interlace: none

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (stride + 1);
    raw[row] = 0; // filter: None
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), row + 1);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ========================================================================== */
/* PNG decoder — verification only (the tests and the post-write check)        */
/* ========================================================================== */

export interface DecodedPng {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  /** Decoded, unfiltered RGBA pixels (width * height * 4 bytes). */
  pixels: Uint8Array;
}

/** Reverse of `encodePng`'s subset of the format; also validates every CRC. */
export function decodePng(input: Uint8Array): DecodedPng {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('decodePng: missing PNG signature');
  }

  let offset = 8;
  let header: { width: number; height: number; bitDepth: number; colorType: number } | undefined;
  const idat: Buffer[] = [];

  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const storedCrc = bytes.readUInt32BE(offset + 8 + length);
    const actualCrc = crc32(bytes.subarray(offset + 4, offset + 8 + length));
    if (storedCrc !== actualCrc) {
      throw new Error(`decodePng: CRC mismatch in ${type} chunk (${storedCrc} !== ${actualCrc})`);
    }

    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
      };
      if (data[12] !== 0) throw new Error('decodePng: interlaced PNGs are not supported');
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }

    offset += 12 + length;
  }

  if (!header) throw new Error('decodePng: no IHDR chunk');
  if (header.bitDepth !== 8 || header.colorType !== 6) {
    throw new Error(`decodePng: unsupported format (depth ${header.bitDepth}, colour type ${header.colorType})`);
  }

  const { width, height } = header;
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  if (raw.length !== (stride + 1) * height) {
    throw new Error(`decodePng: inflated ${raw.length} bytes, expected ${(stride + 1) * height}`);
  }

  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart];
    const out = y * stride;
    const paethBase = out - stride;
    for (let x = 0; x < stride; x += 1) {
      const rawByte = raw[rowStart + 1 + x];
      const left = x >= bytesPerPixel ? pixels[out + x - bytesPerPixel] : 0;
      const up = y > 0 ? pixels[paethBase + x] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? pixels[paethBase + x - bytesPerPixel] : 0;
      let value: number;
      switch (filter) {
        case 0:
          value = rawByte;
          break;
        case 1:
          value = rawByte + left;
          break;
        case 2:
          value = rawByte + up;
          break;
        case 3:
          value = rawByte + ((left + up) >> 1);
          break;
        case 4:
          value = rawByte + paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`decodePng: unknown filter type ${filter} on row ${y}`);
      }
      pixels[out + x] = value & 0xff;
    }
  }

  return { width, height, bitDepth: header.bitDepth, colorType: header.colorType, pixels };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/* ========================================================================== */
/* geometry — pure, unit-tested                                               */
/* ========================================================================== */

export type Vec2 = readonly [number, number];

/**
 * The TaskTick mark in design space: `x`/`y` ∈ [0, 1] of the tile, and the
 * polyline is a checkmark made of two thick round-capped segments.
 */
export const MARK_POINTS: readonly [Vec2, Vec2, Vec2] = [
  [0.3, 0.52],
  [0.452, 0.668],
  [0.735, 0.325],
];

/** Half the stroke width of the checkmark, in design units. */
export const MARK_STROKE_HALF_WIDTH = 0.058;

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface MarkTransform {
  cx: number;
  cy: number;
  /** design units -> pixels */
  scale: number;
  strokeHalfWidth: number;
  points: readonly [Vec2, Vec2, Vec2];
}

/** Shortest distance from a point to a line segment. */
export function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Analytic anti-aliasing: a signed distance of 0 (exactly on the edge) is half
 * covered, and the coverage ramps to 0/1 across `feather` pixels.
 */
export function coverageFromDistance(distance: number, feather = 1): number {
  if (feather <= 0) return distance <= 0 ? 1 : 0;
  const coverage = 0.5 - distance / feather;
  return coverage <= 0 ? 0 : coverage >= 1 ? 1 : coverage;
}

/** Signed distance to an axis-aligned rounded rectangle centred on the origin. */
export function roundedRectDistance(
  px: number,
  py: number,
  width: number,
  height: number,
  radius: number,
): number {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const r = Math.min(radius, halfWidth, halfHeight);
  const qx = Math.abs(px) - (halfWidth - r);
  const qy = Math.abs(py) - (halfHeight - r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - r;
}

/**
 * Optical centre of the mark, derived from the drawn bounds rather than hard
 * coded, so nudging a point in `MARK_POINTS` keeps the glyph centred.
 */
export function markDesignCentre(): Vec2 {
  const xs = MARK_POINTS.map((p) => p[0]);
  const ys = MARK_POINTS.map((p) => p[1]);
  return [
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2,
  ];
}

/** Map the design-space mark onto pixels: `scale` design units == 1 pixel. */
export function markTransform(cx: number, cy: number, scale: number): MarkTransform {
  const [designCx, designCy] = markDesignCentre();
  const place = ([px, py]: Vec2): Vec2 => [cx + (px - designCx) * scale, cy + (py - designCy) * scale];
  const [first, second, third] = MARK_POINTS;
  return {
    cx,
    cy,
    scale,
    strokeHalfWidth: MARK_STROKE_HALF_WIDTH * scale,
    points: [place(first), place(second), place(third)],
  };
}

/** Anti-aliased coverage of the checkmark ink at a pixel centre. */
export function markCoverageAt(px: number, py: number, mark: MarkTransform): number {
  const [a, b, c] = mark.points;
  const first = distanceToSegment(px, py, a[0], a[1], b[0], b[1]) - mark.strokeHalfWidth;
  const second = distanceToSegment(px, py, b[0], b[1], c[0], c[1]) - mark.strokeHalfWidth;
  return coverageFromDistance(Math.min(first, second), 1);
}

/**
 * Ink bounds of the mark in pixels: the polyline's box grown by the stroke's
 * half width (the round caps and joins). Callers that rasterise add their own
 * anti-aliasing margin.
 */
export function markBounds(mark: MarkTransform): Bounds {
  const pad = mark.strokeHalfWidth;
  const xs = mark.points.map((p) => p[0]);
  const ys = mark.points.map((p) => p[1]);
  return {
    minX: Math.min(...xs) - pad,
    minY: Math.min(...ys) - pad,
    maxX: Math.max(...xs) + pad,
    maxY: Math.max(...ys) + pad,
  };
}

/** Distance from the mark's centre to the furthest inked pixel. */
export function markRadius(mark: MarkTransform): number {
  let furthest = 0;
  for (const [px, py] of mark.points) {
    furthest = Math.max(furthest, Math.hypot(px - mark.cx, py - mark.cy));
  }
  return furthest + mark.strokeHalfWidth;
}

/** Drawn width of the mark in design units (bounds + stroke), i.e. of scale 1. */
export const MARK_DESIGN_WIDTH = (() => {
  const bounds = markBounds(markTransform(0, 0, 1));
  return bounds.maxX - bounds.minX;
})();

/** Scale that makes the drawn mark `ratio` of a `size` pixel canvas wide. */
export function markScaleForWidthRatio(size: number, ratio: number): number {
  return (ratio * size) / MARK_DESIGN_WIDTH;
}

/**
 * Android's maskable safe zone: the artwork must live inside the central 80%
 * circle, i.e. within `0.4 * size` of the centre. Used as a hard assertion at
 * generation time, not just as a comment.
 */
export function maskableSafeRadius(size: number): number {
  return 0.4 * size;
}

/* ========================================================================== */
/* rasterisation                                                              */
/* ========================================================================== */

function parseHex(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace('#', '');
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

/** Diagonal gradient sample, `t` ∈ [0, 1] from the top-left to bottom-right. */
function gradientAt(t: number): { r: number; g: number; b: number } {
  const from = parseHex(TILE_GRADIENT_FROM);
  const to = parseHex(TILE_GRADIENT_TO);
  return {
    r: Math.round(from.r + (to.r - from.r) * t),
    g: Math.round(from.g + (to.g - from.g) * t),
    b: Math.round(from.b + (to.b - from.b) * t),
  };
}

export interface IconRenderOptions {
  size: number;
  /** Full-bleed opaque square (maskable + apple-touch) instead of a cornered tile. */
  fullBleed: boolean;
  /** Drawn mark width as a fraction of the canvas width. */
  markWidthRatio: number;
  /** Corner radius as a fraction of `size`; ignored when `fullBleed`. */
  cornerRadiusRatio?: number;
}

/** Rasterise one app icon into straight RGBA bytes. */
export function renderIcon(options: IconRenderOptions): Uint8Array {
  const { size, fullBleed, markWidthRatio, cornerRadiusRatio = TILE_CORNER_RADIUS_RATIO } = options;
  const pixels = new Uint8Array(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const tileRadius = fullBleed ? 0 : cornerRadiusRatio * size;
  const mark = markTransform(cx, cy, markScaleForWidthRatio(size, markWidthRatio));

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const tileCoverage = coverageFromDistance(roundedRectDistance(px - cx, py - cy, size, size, tileRadius), 1);
      const ink = Math.min(tileCoverage, markCoverageAt(px, py, mark));
      const tile = gradientAt((px + py) / (2 * size));
      const alpha = fullBleed ? 1 : tileCoverage;
      const offset = (y * size + x) * 4;
      pixels[offset] = Math.round(tile.r + (MARK_COLOR.r - tile.r) * ink);
      pixels[offset + 1] = Math.round(tile.g + (MARK_COLOR.g - tile.g) * ink);
      pixels[offset + 2] = Math.round(tile.b + (MARK_COLOR.b - tile.b) * ink);
      pixels[offset + 3] = Math.round(alpha * 255);
    }
  }

  return pixels;
}

/**
 * Rasterise an iOS startup image: flat tile colour with the mark centred at
 * `markWidthRatio` of the canvas width. Flat background + a bbox-limited ink
 * pass keeps a 2048x2732 splash cheap.
 */
export function renderSplash(width: number, height: number, markWidthRatio: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  const background = parseHex(SPLASH_BACKGROUND);
  for (let i = 0; i < width * height; i += 1) {
    const offset = i * 4;
    pixels[offset] = background.r;
    pixels[offset + 1] = background.g;
    pixels[offset + 2] = background.b;
    pixels[offset + 3] = 255;
  }

  const mark = markTransform(width / 2, height / 2, markScaleForWidthRatio(width, markWidthRatio));
  const bounds = markBounds(mark);
  const margin = 2; // one pixel of anti-aliasing either side, plus rounding
  const minX = Math.max(0, Math.floor(bounds.minX - margin));
  const minY = Math.max(0, Math.floor(bounds.minY - margin));
  const maxX = Math.min(width, Math.ceil(bounds.maxX + margin));
  const maxY = Math.min(height, Math.ceil(bounds.maxY + margin));

  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      const ink = markCoverageAt(x + 0.5, y + 0.5, mark);
      if (ink <= 0) continue;
      const offset = (y * width + x) * 4;
      pixels[offset] = Math.round(pixels[offset] + (MARK_COLOR.r - pixels[offset]) * ink);
      pixels[offset + 1] = Math.round(pixels[offset + 1] + (MARK_COLOR.g - pixels[offset + 1]) * ink);
      pixels[offset + 2] = Math.round(pixels[offset + 2] + (MARK_COLOR.b - pixels[offset + 2]) * ink);
    }
  }

  return pixels;
}

/** The vector twin of the raster tile, generated from the same geometry. */
export function buildIconSvg(size = 512): string {
  const mark = markTransform(size / 2, size / 2, markScaleForWidthRatio(size, 0.55));
  const [a, b, c] = mark.points;
  const round = (n: number) => Number(n.toFixed(2));
  const path = `M ${round(a[0])} ${round(a[1])} L ${round(b[0])} ${round(b[1])} L ${round(c[0])} ${round(c[1])}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="TaskTick">`,
    '  <defs>',
    `    <linearGradient id="tile" x1="0" y1="0" x2="${size}" y2="${size}" gradientUnits="userSpaceOnUse">`,
    `      <stop offset="0" stop-color="${TILE_GRADIENT_FROM}"/>`,
    `      <stop offset="1" stop-color="${TILE_GRADIENT_TO}"/>`,
    '    </linearGradient>',
    '  </defs>',
    `  <rect width="${size}" height="${size}" rx="${round(size * TILE_CORNER_RADIUS_RATIO)}" fill="url(#tile)"/>`,
    `  <path d="${path}" fill="none" stroke="#ffffff" stroke-width="${round(mark.strokeHalfWidth * 2)}" stroke-linecap="round" stroke-linejoin="round"/>`,
    '</svg>',
    '',
  ].join('\n');
}

/* ========================================================================== */
/* generation                                                                 */
/* ========================================================================== */

interface IconJob extends IconRenderOptions {
  file: string;
  /** Assertions applied to the file after it is written. */
  checks?: {
    /** Every pixel must be fully opaque. */
    opaque?: boolean;
    /** The mark must fit inside the maskable safe circle. */
    maskableSafeZone?: boolean;
  };
}

const ICON_JOBS: IconJob[] = [
  { file: 'icon-192.png', size: 192, fullBleed: false, markWidthRatio: 0.55 },
  { file: 'icon-512.png', size: 512, fullBleed: false, markWidthRatio: 0.55 },
  {
    file: 'icon-maskable-192.png',
    size: 192,
    fullBleed: true,
    markWidthRatio: 0.46,
    checks: { opaque: true, maskableSafeZone: true },
  },
  {
    file: 'icon-maskable-512.png',
    size: 512,
    fullBleed: true,
    markWidthRatio: 0.46,
    checks: { opaque: true, maskableSafeZone: true },
  },
  {
    file: 'apple-touch-icon.png',
    size: 180,
    fullBleed: true,
    markWidthRatio: 0.55,
    checks: { opaque: true },
  },
  { file: 'favicon.png', size: 32, fullBleed: false, markWidthRatio: 0.6 },
];

/** Portrait startup images, one per iOS device pixel size we care about. */
const SPLASH_JOBS: Array<{ file: string; width: number; height: number }> = [
  { file: 'splash-1290x2796.png', width: 1290, height: 2796 }, // 15 Pro Max
  { file: 'splash-1179x2556.png', width: 1179, height: 2556 }, // 15 / 15 Pro
  { file: 'splash-1170x2532.png', width: 1170, height: 2532 }, // 14 / 13 / 12
  { file: 'splash-1284x2778.png', width: 1284, height: 2778 }, // 14 Plus / 12 Pro Max
  { file: 'splash-1125x2436.png', width: 1125, height: 2436 }, // 13 mini / X / 11 Pro
  { file: 'splash-2048x2732.png', width: 2048, height: 2732 }, // iPad Pro 12.9
];

/** iOS shows splash artwork at roughly a quarter of the screen width. */
export const SPLASH_MARK_WIDTH_RATIO = 0.25;

interface WrittenFile {
  file: string;
  bytes: number;
  width: number;
  height: number;
}

function writePng(absolutePath: string, width: number, height: number, pixels: Uint8Array): WrittenFile {
  const png = encodePng(width, height, pixels);
  fs.writeFileSync(absolutePath, png);
  return { file: absolutePath, bytes: png.length, width, height };
}

/**
 * Read a file back off disk and prove it is a decodable PNG of the expected
 * size — plus the per-asset invariants that iOS and Android actually care about.
 * A generator that silently writes a truncated or 1x1 file is worse than none.
 */
function verifyPng(absolutePath: string, expected: { width: number; height: number }, job: IconJob): void {
  const raw = fs.readFileSync(absolutePath);
  if (raw.length === 0) throw new Error(`${absolutePath}: written file is empty`);
  if (!raw.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error(`${absolutePath}: bad PNG signature`);

  const decoded = decodePng(raw);
  if (decoded.width !== expected.width || decoded.height !== expected.height) {
    throw new Error(`${absolutePath}: ${decoded.width}x${decoded.height}, expected ${expected.width}x${expected.height}`);
  }

  const { width, markWidthRatio } = { width: expected.width, ...job };
  if (job.checks?.opaque) {
    for (let i = 3; i < decoded.pixels.length; i += 4) {
      if (decoded.pixels[i] !== 255) {
        throw new Error(`${absolutePath}: pixel ${i / 4} is not opaque — iOS renders transparent icons with black corners`);
      }
    }
  }
  if (job.checks?.maskableSafeZone) {
    // The safe zone is a circle of 80% of the canvas, so artwork may not stray
    // further than 0.4 * size from the centre or Android crops the mark.
    const mark = markTransform(width / 2, width / 2, markScaleForWidthRatio(width, markWidthRatio));
    const radius = markRadius(mark);
    const safe = maskableSafeRadius(width);
    if (radius > safe) {
      throw new Error(`${absolutePath}: mark radius ${radius.toFixed(1)}px exceeds the ${safe}px safe circle`);
    }
  }
}

function formatRow(file: string, bytes: number, width: number, height: number): string {
  const rel = path.relative(process.cwd(), file);
  const size = bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KiB`;
  return `  ${rel.padEnd(44)} ${size.padStart(10)}  ${`${width}x${height}`.padStart(11)}`;
}

export interface GeneratedManifest {
  files: WrittenFile[];
}

/** Write every icon and splash screen. Returns what was written, for the CLI table. */
export function generateAll(root = process.cwd()): GeneratedManifest {
  const iconsDir = path.join(root, 'public', 'icons');
  const splashDir = path.join(root, 'public', 'splash');
  fs.mkdirSync(iconsDir, { recursive: true });
  fs.mkdirSync(splashDir, { recursive: true });

  const files: WrittenFile[] = [];

  for (const job of ICON_JOBS) {
    const absolutePath = path.join(iconsDir, job.file);
    const written = writePng(absolutePath, job.size, job.size, renderIcon(job));
    verifyPng(absolutePath, { width: job.size, height: job.size }, job);
    files.push(written);
  }

  const svgPath = path.join(iconsDir, 'icon.svg');
  const svg = Buffer.from(buildIconSvg(512), 'utf8');
  fs.writeFileSync(svgPath, svg);
  files.push({ file: svgPath, bytes: svg.length, width: 512, height: 512 });

  for (const splash of SPLASH_JOBS) {
    const absolutePath = path.join(splashDir, splash.file);
    const pixels = renderSplash(splash.width, splash.height, SPLASH_MARK_WIDTH_RATIO);
    const written = writePng(absolutePath, splash.width, splash.height, pixels);
    verifyPng(absolutePath, splash, { file: splash.file, size: splash.width, fullBleed: true, markWidthRatio: SPLASH_MARK_WIDTH_RATIO });
    files.push(written);
  }

  return { files };
}

function main(): void {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const started = Date.now();
  const manifest = generateAll(root);

  const totalBytes = manifest.files.reduce((sum, file) => sum + file.bytes, 0);
  const rows = manifest.files.map((file) => formatRow(file.file, file.bytes, file.width, file.height));
  process.stdout.write(
    [
      `TaskTick PWA assets — ${manifest.files.length} files, ${(totalBytes / 1024).toFixed(1)} KiB, ${Date.now() - started}ms`,
      `  ${'FILE'.padEnd(44)} ${'SIZE'.padStart(10)}  ${'PIXELS'.padStart(11)}`,
      ...rows,
      '',
    ].join('\n'),
  );
}

/* Only run when invoked directly (`npx tsx scripts/generate-icons.ts`); the
 * tests import the pure helpers from this module and must not hit the disk. */
const entry = process.argv[1] ?? '';
const isDirectRun =
  entry.endsWith('generate-icons.ts') ||
  (entry.length > 0 && import.meta.url === pathToFileURL(path.resolve(entry)).href);

if (isDirectRun) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

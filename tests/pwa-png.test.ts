/**
 * The hand-rolled PNG encoder behind `scripts/generate-icons.ts`.
 *
 * The icons are generated at build/dev time and committed, so a broken encoder
 * would not fail any app test — it would just quietly ship a corrupt favicon.
 * These tests pin the two things that actually matter: the chunk framing is
 * valid (signature + per-chunk CRC32), and the pixel buffer survives
 * deflate/inflate byte-for-byte.
 */
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PNG_SIGNATURE, crc32, decodePng, encodePng } from '../scripts/generate-icons';

/** Walk the chunk list of a PNG, exposing each chunk's offset for CRC checks. */
function readChunks(
  png: Buffer,
): Array<{ type: string; offset: number; length: number; data: Buffer; crc: number }> {
  const chunks: Array<{ type: string; offset: number; length: number; data: Buffer; crc: number }> = [];
  let offset = 8;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('latin1', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    const crc = png.readUInt32BE(offset + 8 + length);
    chunks.push({ type, offset, length, data, crc });
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  return chunks;
}

describe('crc32', () => {
  it('matches the standard IEEE check value', () => {
    // The canonical CRC-32 test vector: crc32("123456789") === 0xCBF43926.
    expect(crc32(Buffer.from('123456789', 'latin1'))).toBe(0xcbf43926);
  });

  it('is empty-input safe and unsigned', () => {
    expect(crc32(Buffer.alloc(0))).toBe(0);
    expect(crc32(Buffer.from([0xff, 0xff, 0xff, 0xff]))).toBeGreaterThanOrEqual(0);
  });
});

describe('encodePng', () => {
  const pixels = new Uint8Array([
    255, 0, 0, 255, 0, 255, 0, 255, // row 0: red, green
    0, 0, 255, 255, 10, 20, 30, 128, // row 1: blue, translucent
  ]);

  it('writes a valid signature, IHDR, IDAT and IEND', () => {
    const png = encodePng(2, 2, pixels);
    expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');

    const chunks = readChunks(png);
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(chunks[2].length).toBe(0);
  });

  it('declares the requested dimensions and 8-bit RGBA in IHDR', () => {
    const ihdr = readChunks(encodePng(176, 91, new Uint8Array(176 * 91 * 4))).find((c) => c.type === 'IHDR');
    expect(ihdr).toBeDefined();
    expect(ihdr!.data.readUInt32BE(0)).toBe(176);
    expect(ihdr!.data.readUInt32BE(4)).toBe(91);
    expect(ihdr!.data[8]).toBe(8); // bit depth
    expect(ihdr!.data[9]).toBe(6); // truecolour with alpha
    expect(ihdr!.data[12]).toBe(0); // not interlaced
  });

  it('writes a correct CRC32 for every chunk', () => {
    const png = encodePng(2, 2, pixels);
    for (const chunk of readChunks(png)) {
      const body = png.subarray(chunk.offset + 4, chunk.offset + 8 + chunk.length);
      expect(chunk.crc).toBe(crc32(body));
    }
  });

  it('round-trips a known 2x2 buffer through encode and inflate unchanged', () => {
    const png = encodePng(2, 2, pixels);
    const idat = Buffer.concat(readChunks(png).filter((c) => c.type === 'IDAT').map((c) => c.data));
    const raw = zlib.inflateSync(idat);

    // 2 rows of [filter byte 0, four RGBA bytes], filter None.
    const expected = Buffer.concat([
      Buffer.from([0, ...pixels.subarray(0, 8)]),
      Buffer.from([0, ...pixels.subarray(8, 16)]),
    ]);
    expect(raw.equals(expected)).toBe(true);

    // …and the decoder agrees, which also re-validates the next chunk framing.
    const decoded = decodePng(png);
    expect({ width: decoded.width, height: decoded.height }).toEqual({ width: 2, height: 2 });
    expect(Array.from(decoded.pixels)).toEqual(Array.from(pixels));
  });

  it('rejects a buffer whose length does not match the dimensions', () => {
    expect(() => encodePng(2, 2, new Uint8Array(15))).toThrow(/RGBA bytes/);
    expect(() => encodePng(0, 4, new Uint8Array(0))).toThrow(/bad dimensions/);
  });
});

describe('decodePng', () => {
  it('detects a corrupted chunk CRC', () => {
    const png = encodePng(1, 1, new Uint8Array([1, 2, 3, 4]));
    const damaged = Buffer.from(png);
    damaged[damaged.length - 1] ^= 0xff; // last byte is inside IEND's CRC
    expect(() => decodePng(damaged)).toThrow(/CRC mismatch/);
  });

  it('rejects a file without the PNG signature', () => {
    expect(() => decodePng(Buffer.from('not a png at all'))).toThrow(/signature/);
  });
});

// Minimal PNG reader (8-bit RGB/RGBA, non-interlaced) + an ASCII map, so a
// screenshot can be checked without a viewer.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const file = process.argv[2];
const cols = Number(process.argv[3] ?? 72);
const buf = readFileSync(file);
let pos = 8;
let width = 0;
let height = 0;
let channels = 0;
const idat = [];
while (pos < buf.length) {
  const length = buf.readUInt32BE(pos);
  const type = buf.toString('ascii', pos + 4, pos + 8);
  const data = buf.subarray(pos + 8, pos + 8 + length);
  if (type === 'IHDR') {
    width = data.readUInt32BE(0);
    height = data.readUInt32BE(4);
    const depth = data[8];
    const colorType = data[9];
    const interlace = data[12];
    if (depth !== 8 || interlace !== 0 || ![2, 6].includes(colorType)) {
      console.log('unsupported png', { depth, colorType, interlace });
      process.exit(1);
    }
    channels = colorType === 6 ? 4 : 3;
  } else if (type === 'IDAT') {
    idat.push(data);
  } else if (type === 'IEND') break;
  pos += 12 + length;
}
const raw = inflateSync(Buffer.concat(idat));
const stride = width * channels;
const out = Buffer.alloc(height * stride);
let offset = 0;
for (let y = 0; y < height; y += 1) {
  const filter = raw[offset];
  offset += 1;
  const line = raw.subarray(offset, offset + stride);
  offset += stride;
  const target = out.subarray(y * stride, (y + 1) * stride);
  const previous = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
  for (let x = 0; x < stride; x += 1) {
    const a = x >= channels ? target[x - channels] : 0;
    const b = previous ? previous[x] : 0;
    const c = previous && x >= channels ? previous[x - channels] : 0;
    let value = line[x];
    if (filter === 1) value += a;
    else if (filter === 2) value += b;
    else if (filter === 3) value += (a + b) >> 1;
    else if (filter === 4) {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    target[x] = value & 0xff;
  }
}
const pixel = (x, y) => {
  const i = y * stride + x * channels;
  return [out[i], out[i + 1], out[i + 2]];
};
const colors = new Set();
for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) colors.add(pixel(x, y).join(','));
const rows = Math.max(1, Math.round((cols * height) / width / 2));
const ramp = ' .:-=+*#%@';
let art = '';
for (let r = 0; r < rows; r += 1) {
  let line = '';
  for (let c = 0; c < cols; c += 1) {
    const x = Math.min(width - 1, Math.floor(((c + 0.5) * width) / cols));
    const y = Math.min(height - 1, Math.floor(((r + 0.5) * height) / rows));
    // Average a small block so thin text still shows up.
    let sum = 0;
    let count = 0;
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const px = Math.min(width - 1, Math.max(0, x + dx));
        const py = Math.min(height - 1, Math.max(0, y + dy));
        const [rr, gg, bb] = pixel(px, py);
        sum += 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
        count += 1;
      }
    }
    const luminance = sum / count;
    line += ramp[Math.min(ramp.length - 1, Math.floor(((255 - luminance) / 255) * ramp.length))];
  }
  art += `${line}\n`;
}
console.log(`${file} ${width}x${height} channels=${channels} distinctColours=${colors.size}`);
console.log(art);

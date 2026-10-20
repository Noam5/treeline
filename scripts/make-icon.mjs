// Generates build/icon.png — a 512x512 app icon, pure Node, no dependencies.
// Motif: three commit nodes joined by a branching line, echoing the history graph.
// Run once and commit the output: node scripts/make-icon.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const S = 512;
const BG = [24, 26, 31, 255];
const LINE = [88, 166, 255, 255];
const NODE = [240, 246, 252, 255];
const ACCENT = [63, 185, 80, 255];

const px = Buffer.alloc(S * S * 4);
for (let i = 0; i < S * S; i++) px.set(BG, i * 4);

const put = (x, y, c, a = 1) => {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const o = (y * S + x) * 4;
  for (let k = 0; k < 3; k++) px[o + k] = Math.round(px[o + k] * (1 - a) + c[k] * a);
  px[o + 3] = 255;
};

// Anti-aliased disc.
const disc = (cx, cy, r, c) => {
  for (let y = Math.floor(cy - r - 2); y <= Math.ceil(cy + r + 2); y++)
    for (let x = Math.floor(cx - r - 2); x <= Math.ceil(cx + r + 2); x++) {
      const d = Math.hypot(x - cx, y - cy);
      const a = d <= r - 1 ? 1 : d >= r + 1 ? 0 : (r + 1 - d) / 2;
      if (a > 0) put(x, y, c, a);
    }
};

// Anti-aliased thick line segment.
const seg = (x0, y0, x1, y1, w, c) => {
  const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy;
  const minX = Math.floor(Math.min(x0, x1) - w - 2), maxX = Math.ceil(Math.max(x0, x1) + w + 2);
  const minY = Math.floor(Math.min(y0, y1) - w - 2), maxY = Math.ceil(Math.max(y0, y1) + w + 2);
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      let t = len2 === 0 ? 0 : ((x - x0) * dx + (y - y0) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
      const a = d <= w - 1 ? 1 : d >= w + 1 ? 0 : (w + 1 - d) / 2;
      if (a > 0) put(x, y, c, a);
    }
};

// Trunk down the left lane; a branch peels off to the right lane.
const LX = 190, RX = 322, W = 11, R = 34;
seg(LX, 108, LX, 404, W, LINE);
seg(LX, 256, RX, 340, W, ACCENT);
seg(RX, 340, RX, 404, W, ACCENT);

for (const y of [108, 256, 404]) { disc(LX, y, R, LINE); disc(LX, y, R - 9, BG); disc(LX, y, R - 20, NODE); }
disc(RX, 404, R, ACCENT); disc(RX, 404, R - 9, BG); disc(RX, 404, R - 20, ACCENT);

// --- PNG encoding ---
const T = new Int32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c; }
const crc32 = (b) => { let c = -1; for (const v of b) c = T[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };

const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0; // filter: none
  px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = join(dirname(dirname(fileURLToPath(import.meta.url))), 'build', 'icon.png');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`wrote ${out} (${S}x${S}, ${png.length} bytes)`);

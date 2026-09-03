#!/usr/bin/env node
// Generate app/icons/{icon.svg, icon-192.png, icon-512.png, maskable-512.png}.
// A rubricated serif "L" on a madder-red tile. Pure Node: PNGs are written with
// a tiny encoder (zlib + CRC32), the glyph is rectangles, supersampled 4×.

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'icons');
mkdirSync(OUT, { recursive: true });

const BG = [155, 58, 50];       // #9b3a32  (≈ tokens --rubric)
const INK = [251, 250, 248];    // #fbfaf8  (≈ tokens --bg)

// Glyph in unit coordinates (0–1). A serif capital L.
const L_RECTS = [
  [0.335, 0.235, 0.115, 0.545],   // stem
  [0.335, 0.685, 0.395, 0.095],   // foot
  [0.265, 0.235, 0.255, 0.045],   // top serif
  [0.265, 0.735, 0.070, 0.045],   // lower-left serif
  [0.685, 0.595, 0.045, 0.185],   // spur at the end of the foot
];

function inRect(x, y, [rx, ry, rw, rh]) {
  return x >= rx && x < rx + rw && y >= ry && y < ry + rh;
}

function inRoundedSquare(x, y, r) {
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** Render one icon: size px; maskable = full-bleed background (safe zone 80%). */
function render(size, { maskable }) {
  const SS = 4;
  const rgba = new Uint8Array(size * size * 4);
  const radius = 0.22;
  const scale = maskable ? 0.8 : 1;           // shrink glyph into the maskable safe zone
  const off = (1 - scale) / 2;
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let bgCov = 0, inkCov = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          const onTile = maskable ? true : inRoundedSquare(x, y, radius);
          if (!onTile) continue;
          bgCov += 1;
          const gx = (x - off) / scale, gy = (y - off) / scale;
          if (L_RECTS.some((r) => inRect(gx, gy, r))) inkCov += 1;
        }
      }
      const n = SS * SS;
      const a = bgCov / n;
      const t = bgCov ? inkCov / bgCov : 0;
      const i = (py * size + px) * 4;
      rgba[i] = Math.round(BG[0] + (INK[0] - BG[0]) * t);
      rgba[i + 1] = Math.round(BG[1] + (INK[1] - BG[1]) * t);
      rgba[i + 2] = Math.round(BG[2] + (INK[2] - BG[2]) * t);
      rgba[i + 3] = Math.round(255 * a);
    }
  }
  return rgba;
}

// --- PNG encoder ------------------------------------------------------------
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- SVG ---------------------------------------------------------------------
const hex = ([r, g, b]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Latin 103 Reader">
  <rect width="512" height="512" rx="113" fill="${hex(BG)}"/>
  <g fill="${hex(INK)}">
${L_RECTS.map(([x, y, w, h]) => `    <rect x="${(x * 512).toFixed(1)}" y="${(y * 512).toFixed(1)}" width="${(w * 512).toFixed(1)}" height="${(h * 512).toFixed(1)}"/>`).join('\n')}
  </g>
</svg>
`;

writeFileSync(join(OUT, 'icon.svg'), svg);
writeFileSync(join(OUT, 'icon-192.png'), png(192, render(192, { maskable: false })));
writeFileSync(join(OUT, 'icon-512.png'), png(512, render(512, { maskable: false })));
writeFileSync(join(OUT, 'maskable-512.png'), png(512, render(512, { maskable: true })));
console.log(`Wrote icon.svg, icon-192.png, icon-512.png, maskable-512.png → ${OUT}`);

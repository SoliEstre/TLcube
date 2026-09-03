/**
 * a3-wire-aim-overlay.mjs — 채택 육각(빨강) vs 참 코드(초록) 를 한 장에 그린다.
 * 사용: node tools/a3-wire-aim-overlay.mjs [seq] [frameIndex]
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

import { CORNER_UNIT_OFFSETS } from '../src/hexgrid.js';
import { createA3Adapters } from '../src/r2/adapter-locator.js';
import { readLumaDump } from './read-luma.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LABELS = JSON.parse(readFileSync(join(ROOT, 'tools', 'a3-wire-labels.json'), 'utf8'));

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function writePng(path, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y += 1) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  writeFileSync(path, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

function srgb(l) {
  const c = l <= 0 ? 0 : l >= 1 ? 1 : l;
  return c <= 0.0031308 ? c * 12.92 : 1.055 * (c ** (1 / 2.4)) - 0.055;
}

function overlayOne(seqName, frameIndex) {
  const label = LABELS.sequences[seqName];
  if (!label) throw new Error('unknown seq ' + seqName);
  const dir = join(ROOT, 'test', 'output', 'photos', 'luma', label.dir);
  const files = readdirSync(dir).filter((name) => name.endsWith('.luma')).sort();
  const luma = readLumaDump(join(dir, files[frameIndex]));
  const W = luma.width;
  const Hh = luma.height;
  const rgb = Buffer.alloc(W * Hh * 3);
  for (let i = 0; i < W * Hh; i += 1) {
    const b = Math.round(srgb(luma.data[i]) * 255);
    rgb[i * 3] = b; rgb[i * 3 + 1] = b; rgb[i * 3 + 2] = b;
  }
  function px(x, y, r, g, b, rad) {
    const R = rad === undefined ? 1 : rad;
    for (let dy = -R; dy <= R; dy += 1) {
      for (let dx = -R; dx <= R; dx += 1) {
        const xi = Math.round(x) + dx;
        const yi = Math.round(y) + dy;
        if (xi < 0 || yi < 0 || xi >= W || yi >= Hh) continue;
        const o = (yi * W + xi) * 3;
        rgb[o] = r; rgb[o + 1] = g; rgb[o + 2] = b;
      }
    }
  }
  function line(x0, y0, x1, y1, r, g, b) {
    const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) + 1;
    for (let s = 0; s <= steps; s += 1) {
      px(x0 + (x1 - x0) * (s / steps), y0 + (y1 - y0) * (s / steps), r, g, b, 1);
    }
  }
  function hex(cx, cy, R, n, r, g, b) {
    const k = R / n;
    const pts = [];
    for (let i = 0; i < 6; i += 1) {
      const c = CORNER_UNIT_OFFSETS[i];
      pts.push({ x: cx + c.x * n * k, y: cy + c.y * n * k });
    }
    for (let i = 0; i < 6; i += 1) {
      line(pts[i].x, pts[i].y, pts[(i + 1) % 6].x, pts[(i + 1) % 6].y, r, g, b);
    }
    px(cx, cy, r, g, b, 3);
  }
  function hexFromH(H, n, r, g, b) {
    const proj = (x, y) => {
      const w = H[6] * x + H[7] * y + H[8];
      return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
    };
    const pts = [];
    for (let i = 0; i < 6; i += 1) {
      const c = CORNER_UNIT_OFFSETS[i];
      pts.push(proj(c.x * n, c.y * n));
    }
    for (let i = 0; i < 6; i += 1) {
      line(pts[i].x, pts[i].y, pts[(i + 1) % 6].x, pts[(i + 1) % 6].y, r, g, b);
    }
    const c0 = proj(0, 0);
    px(c0.x, c0.y, r, g, b, 3);
    return c0;
  }

  const adapters = createA3Adapters({ n: label.n, relocateEveryFrame: true });
  const detection = { found: 0, family: 0 };
  adapters.detectInto(luma.data, W, Hh, 0, null, detection);
  let pick = null;
  if (detection.found) {
    pick = hexFromH(adapters.H, adapters.stats.n, 255, 40, 40);
  }
  if (Number.isFinite(label.cx) && Number.isFinite(label.cy) && Number.isFinite(label.R)) {
    hex(label.cx, label.cy, label.R, label.n, 40, 255, 40);
  }
  const outDir = join(ROOT, 'test', 'output');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `_a3-aim-${seqName}-f${String(frameIndex).padStart(4, '0')}.png`);
  writePng(outPath, W, Hh, rgb);
  const aimError = pick && Number.isFinite(label.R) && label.R > 0
    ? Math.hypot(pick.x - label.cx, pick.y - label.cy) / label.R
    : null;
  console.log(JSON.stringify({
    seq: seqName,
    frame: files[frameIndex],
    found: detection.found,
    n: adapters.stats.n,
    layoutId: adapters.stats.layoutId,
    pick,
    truth: { cx: label.cx, cy: label.cy, R: label.R, n: label.n },
    aimError,
    out: outPath,
  }));
}

const seqArg = process.argv[2];
const frameArg = Number(process.argv[3] || 0);
const names = seqArg ? [seqArg] : Object.keys(LABELS.sequences);
for (const name of names) overlayOne(name, frameArg);

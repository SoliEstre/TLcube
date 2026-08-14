/*
 * print-poster.test.js — 영상 촬영용 A4 포스터.
 * 인라인 심볼을 파싱해 실제 복호한다. 포스터와 다른 별도 심볼을 만들지 않는다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { decodeFrontend } from '../src/decoder/frontend.js';
import { rasterize } from '../src/raster.js';
import { qrV2ByteMatrix } from '../src/qr-v2-byte.js';
import {
  POSTER_REL,
  POSTER_TL_ECC,
  POSTER_TL_TONES,
  POSTER_TL_TYPE,
  POSTER_TL_VERSION,
  POSTER_URL,
  PRINT_PALETTE,
  QR_QUIET_MODULES,
  SYMBOL_BOX_CLASS,
  SYMBOL_BOX_MM,
  SYMBOL_BOX_TOKEN,
  buildPrintPosterHtml,
} from '../tools/build-print-poster.mjs';
import { decodeQrV2Byte, modulesFromQrSvg } from './harness/qr-v2-byte-decode.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const POSTER = readFileSync(ROOT + POSTER_REL, 'utf8');

function extractBox(html, id) {
  const start = html.indexOf(`id="${id}"`);
  assert.ok(start >= 0, id);
  const open = html.lastIndexOf('<div', start);
  const innerStart = html.indexOf('>', start) + 1;
  const close = html.indexOf('</div>', innerStart);
  return {
    openTag: html.slice(open, innerStart),
    inner: html.slice(innerStart, close),
  };
}

function extractSvg(inner) {
  const from = inner.indexOf('<svg');
  const to = inner.indexOf('</svg>');
  assert.ok(from >= 0 && to > from, 'svg');
  return inner.slice(from, to + 6);
}

function hexToRgb(hex) {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function sceneFromSvg(svg) {
  const vb = svg.match(/viewBox="0 0 ([0-9.]+) ([0-9.]+)"/);
  assert.ok(vb, 'viewBox');
  const width = Number(vb[1]);
  const height = Number(vb[2]);
  let background = { r: 255, g: 255, b: 255 };
  const bg = svg.match(/<rect[^>]*x="0"[^>]*y="0"[^>]*fill="(#[0-9a-fA-F]{6})"/);
  if (bg) background = hexToRgb(bg[1]);
  const shapes = [];
  for (const match of svg.matchAll(/<polygon points="([^"]+)" fill="(#[0-9a-fA-F]{6})"/g)) {
    const points = match[1].trim().split(/\s+/).map((pair) => {
      const [x, y] = pair.split(',');
      return { x: Number(x), y: Number(y) };
    });
    shapes.push({ kind: 'polygon', points, color: hexToRgb(match[2]) });
  }
  for (const match of svg.matchAll(/<circle cx="([^"]+)" cy="([^"]+)" r="([^"]+)" fill="(#[0-9a-fA-F]{6})"/g)) {
    shapes.push({
      kind: 'disc',
      cx: Number(match[1]),
      cy: Number(match[2]),
      r: Number(match[3]),
      color: hexToRgb(match[4]),
    });
  }
  assert.ok(shapes.length > 10, `TLcube 도형이 너무 적다: ${shapes.length}`);
  return { width, height, background, shapes };
}

test('커밋된 포스터와 빌더 출력이 같다', () => {
  assert.equal(POSTER, buildPrintPosterHtml());
});

test('인라인 QR 을 v2 바이트 디코더로 읽으면 POSTER_URL 과 엄격히 같다', () => {
  const { inner, openTag } = extractBox(POSTER, 'qr-symbol');
  assert.match(openTag, new RegExp(`data-payload="${POSTER_URL}"`));
  assert.doesNotMatch(openTag, /data-url=/);
  assert.doesNotMatch(POSTER, /HTTPS:\/\/TL\.ESTRE\.SO/);
  const svg = extractSvg(inner);
  const modules = modulesFromQrSvg(svg, QR_QUIET_MODULES);
  const encoded = qrV2ByteMatrix(POSTER_URL);
  assert.equal(encoded.size, 25);
  assert.deepEqual(Array.from(modules), Array.from(encoded.modules));
  const decoded = decodeQrV2Byte(modules);
  assert.equal(decoded.text, POSTER_URL);
  assert.equal(decoded.mode, 'byte');
  assert.equal(decoded.version, 2);
  assert.equal(decoded.ecc, 'L');
});

test('인라인 TLcube 를 기존 디코더로 읽으면 https://tl.estre.so 다', () => {
  const { inner, openTag } = extractBox(POSTER, 'tlcube-symbol');
  assert.match(openTag, new RegExp(`data-payload="${POSTER_URL}"`));
  assert.match(openTag, new RegExp(`data-type="${POSTER_TL_TYPE}"`));
  assert.match(openTag, new RegExp(`data-version="${POSTER_TL_VERSION}"`));
  assert.match(openTag, new RegExp(`data-tones="${POSTER_TL_TONES}"`));
  assert.match(openTag, new RegExp(`data-ecc="${POSTER_TL_ECC}"`));
  const scene = sceneFromSvg(extractSvg(inner));
  const raster = rasterize(scene, { pixelsPerUnit: 14, supersample: 2 });
  const result = decodeFrontend({
    width: raster.width,
    height: raster.height,
    pixels: raster.pixels,
  });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.text, POSTER_URL);
  assert.equal(result.family, 'cube');
  assert.equal(result.version, POSTER_TL_VERSION);
  assert.equal(result.tones, POSTER_TL_TONES);
});

test('두 심볼이 같은 CSS 박스 토큰을 쓰고 개별 크기 덮어쓰기가 없다', () => {
  const qr = extractBox(POSTER, 'qr-symbol');
  const tl = extractBox(POSTER, 'tlcube-symbol');
  assert.match(qr.openTag, new RegExp(`class="${SYMBOL_BOX_CLASS}"`));
  assert.match(tl.openTag, new RegExp(`class="${SYMBOL_BOX_CLASS}"`));
  assert.match(
    POSTER,
    new RegExp(`\\.${SYMBOL_BOX_CLASS} \\{[\\s\\S]*?width: var\\(${SYMBOL_BOX_TOKEN}\\)`),
  );
  assert.match(
    POSTER,
    new RegExp(`\\.${SYMBOL_BOX_CLASS} \\{[\\s\\S]*?height: var\\(${SYMBOL_BOX_TOKEN}\\)`),
  );
  assert.doesNotMatch(POSTER, /#qr-symbol\s*\{[^}]*width\s*:/);
  assert.doesNotMatch(POSTER, /#tlcube-symbol\s*\{[^}]*width\s*:/);
  assert.doesNotMatch(POSTER, /#qr-symbol\s*\{[^}]*height\s*:/);
  assert.doesNotMatch(POSTER, /#tlcube-symbol\s*\{[^}]*height\s*:/);
  assert.match(extractSvg(qr.inner), /class="quiet-zone"/);
  assert.equal(SYMBOL_BOX_MM, 45);
  assert.match(POSTER, new RegExp(`${SYMBOL_BOX_TOKEN}: ${SYMBOL_BOX_MM}mm`));
  assert.match(POSTER, /\.code-stage\s*\{[\s\S]*?place-items:\s*center/);
});

test('A4 세로 인쇄 규칙과 오프라인 자급성', () => {
  assert.match(POSTER, /@page\s*\{\s*size:\s*A4 portrait/);
  assert.match(POSTER, /@media print/);
  assert.match(POSTER, /print-color-adjust:\s*exact/);
  assert.match(POSTER, /-webkit-print-color-adjust:\s*exact/);
  assert.doesNotMatch(POSTER, /<script\b/);
  assert.doesNotMatch(POSTER, /\b(?:src|href)="https?:/);
  assert.doesNotMatch(POSTER, /cdn\.|fonts\.google|unpkg|jsdelivr/);
  assert.match(POSTER, /<!doctype html>/i);
});

test('영어 카피에 금지 주장·CTA 가 없고 좌→우 라벨이 있다', () => {
  assert.match(POSTER, /<figcaption>QR<\/figcaption>/);
  assert.match(POSTER, /<figcaption>TLcube<\/figcaption>/);
  assert.match(POSTER, />Familiar by design\.</);
  assert.match(POSTER, />Designed to live with your work\.</);
  assert.match(POSTER, />ONE LINK<strong>CHOOSE<br>YOUR WAY<\/strong>/);
  assert.doesNotMatch(POSTER, />then</i);
  assert.match(POSTER, /<div class="dimension">2D<\/div>/);
  assert.match(POSTER, /<div class="dimension">2\.5D<\/div>/);
  assert.match(POSTER, />TYPE Y · THREE-TONE</);
  assert.doesNotMatch(POSTER, />TLCUBE</);
  const qrAt = POSTER.indexOf('id="qr-symbol"');
  const tlAt = POSTER.indexOf('id="tlcube-symbol"');
  assert.ok(qrAt >= 0 && tlAt > qrAt, 'QR 이 왼쪽, TLcube 가 오른쪽');
  assert.doesNotMatch(POSTER, /sign up|get started|download now|subscribe|buy now/i);
  assert.doesNotMatch(POSTER, /<input\b|<button\b|<textarea\b/i);
  assert.doesNotMatch(POSTER, /rotation[- ]tolerant|always scans|replaces QR|guaranteed/i);
  assert.doesNotMatch(POSTER, /0\.4\s*s|1\s*second|live speed|recognition rate/i);
  assert.match(POSTER, /2\.5D visual code/);
  assert.match(POSTER, /open[- ]source/i);
  assert.match(POSTER, /fallback QR/i);
});

test('컬러 인쇄 포스터는 Type Y 3톤 계약과 장식-코드 분리를 고정한다', () => {
  assert.equal(POSTER_TL_TYPE, 'Y');
  assert.equal(POSTER_TL_TONES, 3);
  assert.match(POSTER, /--violet:\s*#6548e8/);
  assert.match(POSTER, /radial-gradient/);
  assert.deepEqual(PRINT_PALETTE.levels, [
    { r: 47, g: 23, b: 56 },
    { r: 184, g: 66, b: 130 },
    { r: 255, g: 209, b: 229 },
  ]);
  assert.match(POSTER, /\.card::before\s*\{[\s\S]*?var\(--violet\), var\(--cyan\)/);
  assert.match(POSTER, /\.card--tlcube::before\s*\{[\s\S]*?var\(--pink\), #ff9a74/);
  assert.match(POSTER, /\.code-stage\s*\{[\s\S]*?background:\s*#ffffff/);
  assert.doesNotMatch(POSTER, /\.symbol-box\s*::(?:before|after)/);
});

/**
 * png.test.js — 결정적 PNG 인코더 검증 (T10)
 *
 * 표준 준수는 오라클로 단언한다: 우리 deflate 를 node:zlib 로 되풀어 원본과
 * 대조하고, 완성 PNG 의 IDAT 을 풀어 언필터한 픽셀이 래스터와 정확히 일치하는지
 * 본다. zlib 은 여기(테스트)에서만 쓴다 — src/png.js 는 브라우저 호환 순수 ESM.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync, inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

import {
  crc32, adler32, deflateFixed, zlibWrap, filterScanlines, rasterToPng,
} from '../src/png.js';
import { encode } from '../src/encode.js';
import { getPreset, DEFAULT_PRESET, BULLSEYE_DARK, BULLSEYE_LIGHT } from '../src/luminance.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';

const ascii = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));

function paletteOf(name) {
  const p = getPreset(name);
  return {
    background: p.background,
    levels: p.levels,
    bullseyeDark: BULLSEYE_DARK,
    bullseyeLight: BULLSEYE_LIGHT,
  };
}

function sampleRaster() {
  const encoded = encode('png 오라클', { version: 1, eccLevel: 'M' });
  const scene = buildScene(encoded, { palette: paletteOf(DEFAULT_PRESET) });
  return rasterize(scene, { pixelsPerUnit: 10, supersample: 2 });
}

// ── 체크섬 KAT (공지 벡터) ──────────────────────────────────────────────────

test('crc32 KAT — "123456789" → 0xCBF43926', () => {
  assert.equal(crc32(ascii('123456789')), 0xcbf43926);
});

test('adler32 KAT — "123456789" → 0x091E01DE', () => {
  assert.equal(adler32(ascii('123456789')), 0x091e01de);
});

// ── deflate 오라클 ──────────────────────────────────────────────────────────

test('deflateFixed — zlib inflateRaw 왕복 (런 많은 데이터·무런 데이터·경계)', () => {
  const cases = [
    new Uint8Array(0),
    Uint8Array.from([7]),
    new Uint8Array(1000).fill(0), //                          단일 런
    Uint8Array.from({ length: 512 }, (_, i) => i % 251), //    런 없음 (전부 리터럴)
    Uint8Array.from({ length: 700 }, (_, i) => (i < 300 ? 42 : i % 7)), // 혼합
    new Uint8Array(258 + 3).fill(9), //                        최대 매치 길이 경계
  ];
  for (const data of cases) {
    const inflated = inflateRawSync(Buffer.from(deflateFixed(data)));
    assert.deepEqual(new Uint8Array(inflated), data);
  }
});

test('zlibWrap — 표준 zlib 스트림으로 풀린다', () => {
  const data = Uint8Array.from({ length: 300 }, (_, i) => (i * 37) % 256);
  const inflated = inflateSync(Buffer.from(zlibWrap(data)));
  assert.deepEqual(new Uint8Array(inflated), data);
});

// ── PNG 구조 + 픽셀 왕복 ────────────────────────────────────────────────────

/** 최소 PNG 파서 (테스트 전용): 청크 분해 + CRC 검증. */
function parsePng(bytes) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  assert.deepEqual([...bytes.subarray(0, 8)], sig, 'PNG 시그니처');
  const chunks = [];
  let offset = 8;
  while (offset < bytes.length) {
    const len = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + len);
    const crc = ((bytes[offset + 8 + len] << 24) | (bytes[offset + 9 + len] << 16)
      | (bytes[offset + 10 + len] << 8) | bytes[offset + 11 + len]) >>> 0;
    assert.equal(crc, crc32(bytes.subarray(offset + 4, offset + 8 + len)), `${type} CRC`);
    chunks.push({ type, data });
    offset += 12 + len;
  }
  return chunks;
}

/** Sub(1)/Up(2) 역필터 (png.js 의 고정 규칙 역연산, 테스트 전용). */
function unfilter(stream, width, height) {
  const stride = width * 3;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = stream[y * (stride + 1)];
    const row = stream.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let j = 0; j < stride; j += 1) {
      let recon;
      if (filter === 1) recon = row[j] + (j >= 3 ? out[y * stride + j - 3] : 0);
      else if (filter === 2) recon = row[j] + out[(y - 1) * stride + j];
      else throw new Error(`예상 밖 필터 타입: ${filter}`);
      out[y * stride + j] = recon & 0xff;
    }
  }
  return out;
}

test('rasterToPng — IDAT 을 풀어 언필터한 픽셀이 래스터와 정확히 일치한다', () => {
  const raster = sampleRaster();
  const png = rasterToPng(raster);
  const chunks = parsePng(png);

  assert.deepEqual(chunks.map((c) => c.type), ['IHDR', 'IDAT', 'IEND']);
  const ihdr = chunks[0].data;
  const width = (ihdr[0] << 24) | (ihdr[1] << 16) | (ihdr[2] << 8) | ihdr[3];
  const height = (ihdr[4] << 24) | (ihdr[5] << 16) | (ihdr[6] << 8) | ihdr[7];
  assert.equal(width, raster.width);
  assert.equal(height, raster.height);
  assert.deepEqual([...ihdr.subarray(8)], [8, 2, 0, 0, 0], '심도 8 · RGB · 표준 압축/필터/논인터레이스');

  const stream = new Uint8Array(inflateSync(Buffer.from(chunks[1].data)));
  assert.deepEqual(stream, filterScanlines(raster.pixels, width, height));
  const rgb = unfilter(stream, width, height);
  for (let i = 0; i < width * height; i += 1) {
    assert.equal(rgb[i * 3], raster.pixels[i * 4]);
    assert.equal(rgb[i * 3 + 1], raster.pixels[i * 4 + 1]);
    assert.equal(rgb[i * 3 + 2], raster.pixels[i * 4 + 2]);
  }
});

test('결정성 — 같은 래스터 2회 인코딩 → 바이트 동일, 압축이 실제로 걸린다', () => {
  const raster = sampleRaster();
  const a = rasterToPng(raster);
  const b = rasterToPng(raster);
  assert.deepEqual(a, b);
  assert.equal(createHash('sha256').update(a).digest('hex'),
    createHash('sha256').update(b).digest('hex'));
  // 평면 채색 이미지 — 거리-1 RLE 만으로도 원시 대비 큰 폭 축소가 정상이다.
  assert.ok(a.length < raster.pixels.length / 4,
    `압축 미달: PNG ${a.length} B vs 원시 RGBA ${raster.pixels.length} B`);
});

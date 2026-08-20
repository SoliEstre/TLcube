/**
 * marker-tones-both-ends.test.js — A-CM 의 «양 끝» 이 같은 톤 표를 보는가.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 왜 이 파일이 따로 있나 — 합성 왕복 테스트가 이 축을 **안 건드린다**
 * ─────────────────────────────────────────────────────────────────────────
 * `cornerMarkerHypotheses` 는 `bootstrap.js` 에서 **`NO_ANCHORS` 일 때만** 불린다.
 * 깨끗한 합성 렌더는 앵커가 살아 정상 경로(formatIndex → CM scan order)로 읽히므로,
 * 왕복 테스트가 전부 초록이어도 **fallback 경로가 조용히 어긋날 수 있다.**
 *
 * 실제로 그럴 뻔했다 (2026-08-20): 검출기 진입점이 정본 H2O 톤을 기본값으로 올렸는데
 * 생성기는 digit 만 실어, fallback 이 **가설 0개**를 냈다. 왕복 35/35 는 초록이었다.
 * 019 의 「양쪽 끝이 다 끊겨 있었다」와 같은 계열이고, 이번엔 **한쪽만 옮겨서** 났다.
 *
 * 그래서 이 파일은 **fallback 진입점을 직접 부른다.** 기대값은 하드코딩하지 않고
 * `h2oTonesByKeyA` 에서 유도한다 — 표가 바뀌면 양 끝이 함께 따라가야 통과한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { encodeA } from '../src/encodeA.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { toRelativeLuminance } from '../src/decoder/luma.js';
import { findACornerMarkerHypotheses } from '../src/decoder/corner-marker-detect.js';
import { markerCellsA, h2oTonesByKeyA, MARKER_CELL_COUNT_A } from '../src/markerA.js';
import { verifyRaster } from '../src/verify.js';
import { getPreset, DEFAULT_PRESET, BULLSEYE_DARK, BULLSEYE_LIGHT } from '../src/luminance.js';

const PPU = 14;
const VERSIONS = [0, 1, 2];

function paletteOf(name) {
  const p = getPreset(name);
  return {
    background: p.background,
    levels: p.levels,
    bullseyeDark: BULLSEYE_DARK,
    bullseyeLight: BULLSEYE_LIGHT,
  };
}

function renderACM(version) {
  const encoded = encodeA('TLcube-both-ends', { version, eccLevel: 'M', cornerMarker: true });
  const scene = buildScene(encoded, { palette: paletteOf(DEFAULT_PRESET), margin: 20 });
  const raster = rasterize(scene, { pixelsPerUnit: PPU, supersample: 2 });
  return { encoded, luma: toRelativeLuminance(raster) };
}

test('① 생성기는 마커 셀 전부에 톤을 싣는다 — 개수는 markerA 에서 유도', () => {
  for (const version of VERSIONS) {
    const encoded = encodeA('x', { version, eccLevel: 'M', cornerMarker: true });
    const markers = [...encoded.cellDigits.values()].filter((v) => v.role === 'marker');
    assert.equal(markers.length, MARKER_CELL_COUNT_A,
      `A${version}CM 마커 셀 수가 markerA 상수와 다르다`);
    assert.equal(markers.filter((v) => v.tones).length, MARKER_CELL_COUNT_A,
      `A${version}CM 마커 셀에 톤이 안 실렸다 — fallback 검출기가 이 프레임을 기각한다`);
  }
});

test('② 생성기가 실은 톤은 검출기가 기본값으로 쓰는 그 표다 (하드코딩 아님)', () => {
  for (const version of VERSIONS) {
    const encoded = encodeA('x', { version, eccLevel: 'M', cornerMarker: true });
    const expected = markerCellsA(encoded.k, h2oTonesByKeyA(encoded.k));
    for (const cell of expected) {
      const got = encoded.cellDigits.get(`${cell.q},${cell.r}`);
      assert.ok(got, `A${version}CM (${cell.q},${cell.r}) 마커 셀이 없다`);
      assert.deepEqual(got.tones, cell.tones,
        `A${version}CM (${cell.q},${cell.r}) 톤이 markerA 표와 다르다`);
    }
  }
});

test('③ fallback 진입점이 생성기 렌더를 읽는다 — 이 경로는 왕복 테스트가 안 건드린다', () => {
  for (const version of VERSIONS) {
    const { encoded, luma } = renderACM(version);
    const bullseye = { center: { x: luma.width / 2, y: luma.height / 2 }, cellSize: PPU };
    const res = findACornerMarkerHypotheses(luma, bullseye, [encoded.k], {});
    const found = (res && res.hypotheses) || (res && res.detail && res.detail.hypotheses) || [];
    assert.equal(res.ok, true,
      `A${version}CM: fallback 이 ${res.reason} 로 실패했다`
      + ' — 생성기와 검출기가 다른 톤 표를 보고 있다');
    assert.ok(found.length >= 1, `A${version}CM: 통과 가설 0개`);
    // 통과 목록에 실린다는 것 자체가 accepted 를 뜻한다 (`hypotheses.push` 는
    // `verification.accepted && confirmed` 뒤에 있다). 여기선 «완전 일치» 만 더 본다 —
    // 무왜곡 합성 렌더이므로 agreement 는 1 이어야 하고, 아니면 톤 표가 어긋난 것이다.
    for (const h of found) {
      assert.equal(h.agree, h.slots,
        `A${version}CM: agreement ${h.agree}/${h.slots} — 무왜곡 렌더인데 완전 일치가 아니다`);
    }
  }
});

test('④ 톤이 선언과 어긋나면 verifyRaster 가 잡는다 — 톤 셀도 «검사 안 하는 셀» 이 아니다', () => {
  const encoded = encodeA('TLcube-tone-guard', { version: 1, eccLevel: 'M', cornerMarker: true });
  const scene = buildScene(encoded, { palette: paletteOf(DEFAULT_PRESET), margin: 20 });
  const raster = rasterize(scene, { pixelsPerUnit: PPU, supersample: 2 });

  // 원본은 깨끗해야 한다.
  assert.equal(verifyRaster(raster, scene, encoded).mismatches.length, 0,
    '무왜곡 렌더인데 mismatch 가 있다');

  // 렌더는 그대로 두고 **선언만** 어긋나게 한다 — 밝기 순서와 반대인 톤을 심는다.
  const tones = h2oTonesByKeyA(encoded.k);
  let flippedKey = null;
  const mutated = new Map();
  for (const [kk, entry] of encoded.cellDigits) {
    if (!flippedKey && entry.tones && new Set(Object.values(entry.tones)).size > 1) {
      const t = entry.tones;
      // 서로 다른 두 면을 뒤집는다 — 순서 검사가 잡아야 한다.
      const faces = ['T', 'L', 'R'];
      const [a, b] = faces.filter((f, i) => faces.some((g, j) => j > i && t[g] !== t[f])).slice(0, 2);
      const swapped = { ...t, [a]: t[b], [b]: t[a] };
      if (JSON.stringify(swapped) !== JSON.stringify(t)) {
        mutated.set(kk, { ...entry, tones: swapped });
        flippedKey = kk;
        continue;
      }
    }
    mutated.set(kk, entry);
  }
  assert.ok(flippedKey, '뒤집을 비-균일 톤 셀을 못 찾았다 — 표가 바뀌었나');

  const bad = verifyRaster(raster, scene, { ...encoded, cellDigits: mutated });
  assert.ok(bad.mismatches.length >= 1,
    `선언 톤을 뒤집었는데 verifyRaster 가 못 잡는다 (${flippedKey})`);
  assert.equal(bad.mismatches[0].q !== undefined, true);
});

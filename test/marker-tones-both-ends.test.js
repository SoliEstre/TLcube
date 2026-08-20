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
import { markerCellsA, markerGroupsA, h2oTonesByKeyA, MARKER_CELL_COUNT_A } from '../src/markerA.js';
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

/** 톤을 **명시로** 실어 렌더한다 — 기본 경로는 톤을 안 싣기 때문이다. */
function withTones(encoded) {
  const tones = h2oTonesByKeyA(encoded.k);
  const cellDigits = new Map();
  for (const [kk, entry] of encoded.cellDigits) {
    const t = tones.get(kk);
    cellDigits.set(kk, t ? { ...entry, tones: t } : entry);
  }
  return { ...encoded, cellDigits };
}

function renderACM(version) {
  const encoded = withTones(encodeA('TLcube-both-ends', { version, eccLevel: 'M', cornerMarker: true }));
  const scene = buildScene(encoded, { palette: paletteOf(DEFAULT_PRESET), margin: 20 });
  const raster = rasterize(scene, { pixelsPerUnit: PPU, supersample: 2 });
  return { encoded, luma: toRelativeLuminance(raster) };
}

test('① 마커 셀 전부에 톤(심볼)이 실린다 — 개수는 markerA 에서 유도', () => {
  for (const version of VERSIONS) {
    const encoded = encodeA('x', { version, eccLevel: 'M', cornerMarker: true });
    const markers = [...encoded.cellDigits.values()].filter((v) => v.role === 'marker');
    assert.equal(markers.length, MARKER_CELL_COUNT_A,
      `A${version}CM 마커 셀 수가 markerA 상수와 다르다`);
    // 2026-08-21: 톤(=심볼)을 **싣는다.** 실루엣을 지키는 것은 톤이 아니라 «팔레트» 이고,
    // 그건 scene.js 가 palette.levels 로 칠해서 지킨다 (scene-marker-tones 가 고정).
    assert.equal(markers.filter((v) => v.tones).length, MARKER_CELL_COUNT_A,
      `A${version}CM 이 톤을 안 싣는다 — 마커 심볼이 사라진다`);
    const withTones = markerCellsA(encoded.k, h2oTonesByKeyA(encoded.k));
    assert.equal(withTones.length, MARKER_CELL_COUNT_A);
    assert.equal(withTones.filter((c) => c.tones).length, MARKER_CELL_COUNT_A,
      '톤 적재 기제가 죽었다');
  }
});

test('② 톤 표는 발자국과 좌표가 정확히 겹친다 (하드코딩 아님)', () => {
  for (const version of VERSIONS) {
    const encoded = encodeA('x', { version, eccLevel: 'M', cornerMarker: true });
    for (const cell of markerCellsA(encoded.k, h2oTonesByKeyA(encoded.k))) {
      const got = encoded.cellDigits.get(`${cell.q},${cell.r}`);
      assert.ok(got, `A${version}CM (${cell.q},${cell.r}) 마커 셀이 없다`);
      assert.equal(got.role, 'marker');
    }
  }
});

test('③ ⛔ 알려진 공백 — 데이터 팔레트에서는 절대 톤 검출이 «아직» 안 선다', () => {
  // 2026-08-20/21. 운영자 실기기 보고로 마커를 파인더 축(순백 포함)에서 **데이터
  // 팔레트로 되돌렸다** — 순백 셀이 안전영역·흰 지면과 구별되지 않아 실루엣에 구멍이
  // 나고 원거리 인식률이 떨어졌기 때문이다 (scene.js faceColor 주석).
  //
  // 그러자 절대 톤 채점이 깨졌다. 원인은 팔레트가 **등간격이 아니라는 것**이다:
  //
  //     levels          0.0612 / 0.2436 / 0.7699
  //     dark·bright 두 앵커의 선형 보간 중간대  [0.3163, 0.5148]
  //     → levels[1] 이 그 아래라 톤 1 이 톤 0 으로 분류된다
  //
  // 파인더 축(0 / 0.5 / 1.0)은 등간격이라 이 결함이 안 보였다 — **자가 팔레트에
  // 의존하고 있었다.** 3앵커 최근접으로 고치는 시도는 교차 오수용을 열어 되돌렸다.
  //
  // ▶ 이 테스트가 빨개지면(=검출이 서기 시작하면) 축하한다. 그때 할 일:
  //   (a) 이 테스트를 «선다» 쪽으로 뒤집고
  //   (b) encodeA 의 marker provider 에 톤을 다시 싣고 (src/encodeA.js)
  //   (c) findACornerMarkerHypotheses 기본값도 같이 켜라 — **한쪽만 켜면 효과가 음수다**
  for (const version of VERSIONS) {
    const { encoded, luma } = renderACM(version);
    const bullseye = { center: { x: luma.width / 2, y: luma.height / 2 }, cellSize: PPU };
    const res = findACornerMarkerHypotheses(luma, bullseye, [encoded.k],
      { groups: markerGroupsA(encoded.k, h2oTonesByKeyA(encoded.k)) });
    assert.equal(res.ok, false,
      `A${version}CM 절대 톤 검출이 서기 시작했다 — 위 (a)(b)(c) 를 같은 커밋에서 처리하라`);
  }
});

test('④ 톤이 선언과 어긋나면 verifyRaster 가 잡는다 — 톤 셀도 «검사 안 하는 셀» 이 아니다', () => {
  const encoded = withTones(encodeA('TLcube-tone-guard', { version: 1, eccLevel: 'M', cornerMarker: true }));
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
